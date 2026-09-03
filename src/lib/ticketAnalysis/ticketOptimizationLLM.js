import { canUseSemanticMatch } from '../themeSemantic.js'
import {
  getLlmCompletionText,
  llmChatCompletion,
  parseLlmMessageContent,
} from '../llmClient.js'
import { isGenericMeasure } from '../journeyOptimizationLLM.js'

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function normalizeOptimizationList(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter((item) => item && !isGenericMeasure(item))
}

/**
 * @param {string[]} items
 * @param {number} max
 */
function joinOptimizations(items, max) {
  return [...new Set(items)].slice(0, max).join('\n')
}

/**
 * @param {Object} input
 * @param {string} input.text
 * @param {string} [input.solutionSummary]
 * @param {string} [input.rootCause]
 * @param {string} [input.journeyL2]
 * @param {string} [input.painPoint]
 * @param {string} [input.requestScene]
 * @param {string} [input.problemType]
 * @param {boolean} [input.fuzzy]
 * @param {boolean} [input.compact] 为 true 时不附带工单正文（按需 optimization 补打）
 * @param {string} [input.productName] 投诉产品名（知识库注入用）
 * @param {string} [input.knowledgeSnippets] 格式化后的知识库片段（空则不注入）
 * @param {import('../storage.js').AppSettings} settings
 * @param {{ knowledgeSnippets?: string; productName?: string }} [extras]
 * @returns {Promise<{ optimizationProduct: string; optimizationService: string; optimizationSuggestion: string }>}
 */
export async function extractTicketOptimizationsWithLLM(input, settings, extras = {}) {
  const merged = { ...input, ...extras }
  if (!canUseSemanticMatch(settings)) {
    return { optimizationProduct: '', optimizationService: '', optimizationSuggestion: '' }
  }

  const text = merged.compact ? '' : (merged.text || '').slice(0, 4000)
  const painPoint = (merged.painPoint || '').slice(0, 120)
  const rootCause = (merged.rootCause || '').slice(0, 200)
  const solutionSummary = (merged.solutionSummary || '').slice(0, 300)

  const systemPrompt = `你是移动云产品体验优化专家。针对单条投诉/咨询工单，输出可落地的优化建议。

规则：
1. productOptimizations 必须至少 1 条：针对功能、交互、默认策略、报错提示或架构限制的具体改进。
2. serviceOptimizations 按需输出（无明确服务短板可不输出）：针对 SLA、跨组协同、催办机制、知识库或升级路径。
3. 每条 25～80 字，具体可执行，禁止「加强培训」「优化体验」「提升效率」「纳入规划」等空泛表述。
4. 不要复述工单临时规避操作，要提炼根本改进方向。
5. 若提供了「产品知识库参考」，优先依据其中与工单相关的规则/特性给出可执行改进；跨产品痛点可综合多产品知识库。
6. 只返回 JSON：{"productOptimizations":["..."],"serviceOptimizations":["..."]}`

  const bodyBlock = text
    ? `\n\n工单正文：\n${text}`
    : '\n\n（已提供需求痛点与维度上下文，无需工单全文）'

  const userPrompt = `产品：${merged.productName || '未标注'}
${merged.knowledgeSnippets ? `\n产品知识库参考（优化建议优先依据其中与工单相关的规则/特性；跨产品痛点可综合多产品知识库）：\n${merged.knowledgeSnippets}\n` : ''}
需求痛点：${painPoint || '未提取'}
问题类型：${merged.problemType || '未分类'}
请求场景：${merged.requestScene || '未分类'}
用户旅程二级：${merged.journeyL2 || '未识别'}
有效根因：${rootCause || '无'}
处理结论：${solutionSummary || '无'}
内容是否模糊需路径兜底：${merged.fuzzy ? '是' : '否'}${bodyBlock}

请输出单条工单的优化建议。`

  const data = await llmChatCompletion(settings, {
    temperature: 0.35,
    max_tokens: 768,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
  })

  const parsed = parseLlmMessageContent(getLlmCompletionText(data))
  const product = normalizeOptimizationList(parsed.productOptimizations)
  const service = normalizeOptimizationList(parsed.serviceOptimizations)

  const optimizationProduct = joinOptimizations(product, 3)
  const optimizationService = joinOptimizations(service, 2)
  const optimizationSuggestion = [optimizationProduct, optimizationService].filter(Boolean).join('\n')

  return { optimizationProduct, optimizationService, optimizationSuggestion }
}
