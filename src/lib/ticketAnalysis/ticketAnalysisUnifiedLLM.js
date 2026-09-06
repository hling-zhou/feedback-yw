import { canUseSemanticMatch } from '../themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import {
  CUSTOMER_REQUEST_HARD_MAX,
  truncateCustomerRequest,
} from './customerRequestExtract.js'
import { isValidLlmCustomerRequest } from './customerRequestLLM.js'
import { isValidLlmPainPoint } from './painPointLLM.js'
import {
  extractRootCauseWithLLM,
  isValidLlmRootCause,
  pickLlmRootCauseField,
  truncateRootCause,
} from './rootCauseLLM.js'
import { truncatePainPoint, PAIN_POINT_HARD_MAX } from './painPointExtract.js'
import { extractTicketOptimizationsWithLLM } from './ticketOptimizationLLM.js'
import { validateTicketAnalysisPair } from './validateTicketAnalysisPair.js'
import {
  isValidUnifiedOptimization,
  joinUnifiedOptimizationFields,
} from './validateUnifiedOptimization.js'
import { getConfiguredJourneyTips, getConfiguredProblemTypeTips } from '../planningConfigLoader.js'

/**
 * @typedef {'customerRequest' | 'painPoint' | 'rootCause' | 'optimization'} TicketAnalysisPartialFailure
 */

/**
 * @typedef {Object} TicketAnalysisUnifiedInput
 * @property {string} taggingText
 * @property {import('./customerRequestExtract.js').CustomerRequestCandidate[]} [candidates]
 * @property {{ customerRequest: string; painPoint: string; optimizationProduct: string; optimizationService: string }} ruleFallback
 * @property {string} [handlingText]
 * @property {string} [rootCause]
 * @property {string} [solutionSummary]
 * @property {string} [requestScene]
 * @property {string} [problemType]
 * @property {string} [journeyL2]
 * @property {boolean} [fuzzy]
 * @property {string} [productName] 投诉产品名（知识库注入用）
 * @property {string} [knowledgeSnippets] 格式化后的知识库片段（空则不注入）
 */

/**
 * @typedef {Object} TicketAnalysisUnifiedResult
 * @property {string} customerRequest
 * @property {string} painPoint
 * @property {string} rootCause
 * @property {string} optimizationProduct
 * @property {string} optimizationService
 * @property {string} optimizationSuggestion
 * @property {'rule' | 'llm'} customerRequestSource
 * @property {'rule' | 'llm'} painPointSource
 * @property {'rule' | 'llm'} rootCauseSource
 * @property {'rule' | 'llm'} optimizationSource
 * @property {TicketAnalysisPartialFailure[]} [partialFailures]
 * @property {boolean} [optimizationRetry]
 */

/**
 * @param {import('../storage.js').AppSettings} settings
 */
export function resolveTicketLlmMode(settings) {
  const mode = settings?.ticketLlmMode
  if (mode === 'separate' || mode === 'split2' || mode === 'unified') return mode
  return 'unified'
}

/**
 * @param {TicketAnalysisUnifiedInput} input
 */
function buildPlaybookBlock(input) {
  const tips = [
    ...getConfiguredJourneyTips(input.journeyL2, input.productName),
    ...getConfiguredProblemTypeTips(input.problemType, input.productName),
  ].filter((line, i, arr) => line && arr.indexOf(line) === i).slice(0, 4)
  if (!tips.length) return ''
  return `\n已沉淀的产品优化话术（可参考语气与方向，勿照抄编号）：\n${tips.join('\n')}\n`
}

/**
 * @param {TicketAnalysisUnifiedInput} input
 */
function buildUnifiedUserPrompt(input) {
  const taggingText = (input.taggingText || '').slice(0, 4000)
  const candidatesBlock = (input.candidates || [])
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((c, i) => `${i + 1}. [phase ${c.phase}] ${c.text}`)
    .join('\n')

  return `请按顺序完成四步分析，并输出一个 JSON 对象。

规则层客户请求候选（按出现顺序）：
${candidatesBlock || '（无）'}

规则 fallback：
- customerRequest: ${input.ruleFallback.customerRequest || '（空）'}
- painPoint: ${input.ruleFallback.painPoint || '（空）'}
- rootCause: ${input.rootCause || '（空）'}

产品：${input.productName || '未标注'}
${input.knowledgeSnippets ? `\n产品知识库参考（优化建议优先依据其中与工单相关的规则/特性；跨产品痛点可综合多产品知识库）：\n${input.knowledgeSnippets}\n` : ''}${buildPlaybookBlock(input)}
维度（优化建议参考）：
- 问题类型：${input.problemType || '未分类'}
- 请求场景：${input.requestScene || '未分类'}
- 用户旅程二级：${input.journeyL2 || '未识别'}
- 处理结论：${input.solutionSummary || '无'}
- 内容模糊需路径兜底：${input.fuzzy ? '是' : '否'}

处理意见（问题原因的重点证据）：
${(input.handlingText || '').slice(0, 2000) || '（无）'}

工单正文（受理/处理/追加）：
${taggingText}

输出 JSON（rootCause 与 productOptimizations 均不可省略）：
{"customerRequest":"...","painPoint":"...","rootCause":"...","productOptimizations":["..."],"serviceOptimizations":["..."]}`
}

const UNIFIED_SYSTEM_PROMPT = `你是云计算客户体验分析师兼产品体验优化专家。从单条工单完成四项提取。

步骤 1 — 客户请求内容：
- 综合受理、协办、反馈、追加等客户诉求；多轮优先级：明确修正 > 严重性最高 > 最新未解决 > 最完整。
- 删除内部流转话术与情绪词；必须基于工单事实；≤80 字，最长 ${CUSTOMER_REQUEST_HARD_MAX} 字。
- 只写客户诉求/问题现象，禁止写入「解决方案」「处理意见」字段或平台结论（如「客户未提供信息」「离线处理」）。

步骤 2 — 需求痛点：
- 以步骤 1 为主输入，聚焦未满足诉求或问题本质；禁止「用户希望/建议/反馈/要求」开头。
- 比客户请求更本质一层且不矛盾；最长 ${PAIN_POINT_HARD_MAX} 字。

步骤 3 — 问题原因：
- 写导致步骤 2 表象的可核对配置、组件或流程状态，如「安全组未放行 22 端口」。
- 禁止客户感受、责任归属（云能问题/产品原因/运维原因等）和处置（已建群、已协助放行）。
- 证据优先级：处理意见里的「根因/定位为/经排查」> 受理中的客观结论 > 已有 rootCause（仅参考）。
- 证据不足写「工单未定位到具体问题原因」；一句中文，约 8–40 字。投诉原因树最多写三级。

步骤 4 — 优化建议（不可省略 productOptimizations）：
- productOptimizations 至少 1 条：针对步骤 3 的问题原因给出功能/交互/策略/报错等可执行改进，每条 25～80 字。
- 若提供了「产品知识库参考」，优先依据其中与工单相关的规则/特性给出可执行改进；跨产品痛点可综合多产品知识库。
- serviceOptimizations 按需：SLA/协同/知识库等；禁止空泛套话。
- 不要复述临时规避操作。

只返回一个 JSON 对象，字段：customerRequest, painPoint, rootCause, productOptimizations, serviceOptimizations。`

/**
 * @param {TicketAnalysisUnifiedInput} input
 * @param {import('../storage.js').AppSettings} settings
 * @param {{ knowledgeSnippets?: string; productName?: string }} [extras]
 * @returns {Promise<TicketAnalysisUnifiedResult>}
 */
export async function extractTicketAnalysisUnifiedWithLLM(input, settings, extras = {}) {
  const rule = input.ruleFallback
  /** @type {TicketAnalysisPartialFailure[]} */
  const partialFailures = []

  let customerRequest = rule.customerRequest
  let painPoint = rule.painPoint
  let rootCause = input.rootCause?.trim() || ''
  let optimizationProduct = rule.optimizationProduct
  let optimizationService = rule.optimizationService
  let customerRequestSource = /** @type {'rule' | 'llm'} */ ('rule')
  let painPointSource = /** @type {'rule' | 'llm'} */ ('rule')
  let rootCauseSource = /** @type {'rule' | 'llm'} */ ('rule')
  let optimizationSource = /** @type {'rule' | 'llm'} */ ('rule')
  let optimizationRetry = false

  if (!canUseSemanticMatch(settings)) {
    const optimizationSuggestion = [optimizationProduct, optimizationService]
      .filter(Boolean)
      .join('\n')
    const validated = validateTicketAnalysisPair(customerRequest, painPoint, rule.customerRequest, rule.painPoint)
    return {
      customerRequest: validated.customerRequest,
      painPoint: validated.painPoint,
      rootCause,
      optimizationProduct,
      optimizationService,
      optimizationSuggestion,
      customerRequestSource,
      painPointSource,
      rootCauseSource,
      optimizationSource,
    }
  }

  try {
    const data = await llmChatCompletion(settings, {
      temperature: 0.15,
      max_tokens: 1024,
      messages: [
        { role: 'system', content: UNIFIED_SYSTEM_PROMPT },
        { role: 'user', content: buildUnifiedUserPrompt({ ...input, ...extras }) },
      ],
    })

    const parsed = parseLlmMessageContent(getLlmCompletionText(data))
    const rawRequest =
      typeof parsed.customerRequest === 'string' ? parsed.customerRequest.trim() : ''
    const rawPain = typeof parsed.painPoint === 'string' ? parsed.painPoint.trim() : ''
    const unifiedRootCause = pickLlmRootCauseField(parsed)
    if (unifiedRootCause) {
      const cleaned = truncateRootCause(unifiedRootCause)
      if (isValidLlmRootCause(cleaned)) {
        rootCause = cleaned
        rootCauseSource = 'llm'
      }
    }

    if (isValidLlmCustomerRequest(rawRequest, rule.customerRequest)) {
      customerRequest = truncateCustomerRequest(rawRequest)
      customerRequestSource = 'llm'
    } else if (rawRequest) {
      partialFailures.push('customerRequest')
    }

    if (isValidLlmPainPoint(rawPain)) {
      painPoint = truncatePainPoint(rawPain)
      painPointSource = 'llm'
    } else if (rawPain) {
      partialFailures.push('painPoint')
    }

    const joined = joinUnifiedOptimizationFields(parsed)
    if (isValidUnifiedOptimization({ ...joined, productOptimizations: parsed.productOptimizations })) {
      optimizationProduct = joined.optimizationProduct
      optimizationService = joined.optimizationService
      optimizationSource = 'llm'
    } else {
      partialFailures.push('optimization')
    }
  } catch (err) {
    console.warn('[ticket-llm-unified] 合并 LLM 失败，保留规则结果:', err)
    partialFailures.push('customerRequest', 'painPoint', 'rootCause', 'optimization')
  }

  const validated = validateTicketAnalysisPair(
    customerRequest,
    painPoint,
    rule.customerRequest,
    rule.painPoint,
  )
  customerRequest = validated.customerRequest
  painPoint = validated.painPoint

  // 统一调用未写出可用问题原因时，再单独补打（与 optimization 补打同级兜底）
  if (rootCauseSource !== 'llm' && canUseSemanticMatch(settings)) {
    try {
      const llmRootCause = await extractRootCauseWithLLM(
        {
          taggingText: input.taggingText,
          handlingText: input.handlingText,
          rootCause,
          painPoint,
        },
        settings,
      )
      if (llmRootCause && isValidLlmRootCause(llmRootCause)) {
        rootCause = truncateRootCause(llmRootCause)
        rootCauseSource = 'llm'
      } else {
        partialFailures.push('rootCause')
      }
    } catch (err) {
      console.warn('[ticket-llm-unified] 问题原因补打失败，保留规则/导入值:', err)
      partialFailures.push('rootCause')
    }
  }

  let optimizationSuggestion = [optimizationProduct, optimizationService].filter(Boolean).join('\n')

  if (optimizationSource !== 'llm' && canUseSemanticMatch(settings)) {
    try {
      const llmOpt = await extractTicketOptimizationsWithLLM(
        {
          text: '',
          compact: true,
          solutionSummary: input.solutionSummary,
          rootCause: input.rootCause,
          journeyL2: input.journeyL2,
          painPoint,
          requestScene: input.requestScene,
          problemType: input.problemType,
          fuzzy: input.fuzzy,
        },
        settings,
      )
      if (llmOpt.optimizationProduct || llmOpt.optimizationService) {
        optimizationProduct = llmOpt.optimizationProduct || optimizationProduct
        optimizationService = llmOpt.optimizationService || optimizationService
        optimizationSuggestion = llmOpt.optimizationSuggestion || optimizationSuggestion
        optimizationSource = 'llm'
        optimizationRetry = true
        const idx = partialFailures.indexOf('optimization')
        if (idx >= 0) partialFailures.splice(idx, 1)
      }
    } catch (err) {
      console.warn('[ticket-llm-unified] optimization 补打失败，保留规则结果:', err)
    }
  }

  return {
    customerRequest,
    painPoint,
    rootCause,
    optimizationProduct,
    optimizationService,
    optimizationSuggestion,
    customerRequestSource,
    painPointSource,
    rootCauseSource,
    optimizationSource,
    ...(partialFailures.length ? { partialFailures } : {}),
    ...(optimizationRetry ? { optimizationRetry: true } : {}),
  }
}
