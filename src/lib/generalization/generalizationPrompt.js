import { llmChatCompletion, getLlmCompletionText, parseLlmMessageContent } from '../llmClient.js'
import {
  GENERALIZATION_CATEGORIES,
  GENERALIZATION_SCOPES,
} from '../../domain/generalizationIssue.js'

/**
 * G-pass：发现型建议（DESIGN-20261102-1.md §3.1 / TASKS G2-3）。
 *
 * 判据（prompt 内嵌原文）：
 * - 判据 A（共性）：问题场景或出错原因具备跨场景/跨产品共性——非单产品偶发特例 → scope；
 * - 判据 B（可介入）：根因落在六类可介入范畴之一；纯客户侧/第三方侧原因（客户自己配错、
 *   理解偏差）不算——产品侧没有可改进动作，举一反三无处可"反"。
 *
 * 主判材料：处理意见终段（口径 = split('处理意见：')[-1]——根因与实际处理结果写在这段）；
 * 痛点提供症状佐证；辅助维度（请求场景/问题类型/旅程 L1）供参照。
 *
 * 输出 strict JSON：needsGeneralization yes/no + category（六选一只选不造）+ scope + confidence + reason。
 * 门槛：yes 且 confidence ≥ medium 才落 hint；no / low / 解析失败 → 静默不落（宁漏勿错）。
 */

/** prompt 版本（hint 落库带此值——升级 prompt 后可探测旧 pending 重判，v3.3 ⑥） */
export const GENERALIZATION_PROMPT_VERSION = 'g1'

/** 画像文本字符上限 */
const PROFILE_TEXT_CAP = 600

/**
 * @param {string} text
 * @param {number} cap
 */
function clipText(text, cap = PROFILE_TEXT_CAP) {
  const t = String(text || '').trim()
  if (t.length <= cap) return t
  return t.slice(0, cap)
}

/**
 * 处理意见终段提取（分类判据真源口径：split('处理意见：')[-1]）。
 * @param {unknown} recordInput
 * @returns {string}
 */
export function extractHandlingConclusion(recordInput) {
  const record = /** @type {Record<string, unknown>} */ (
    recordInput && typeof recordInput === 'object' ? recordInput : {}
  )
  const handling = String(record.handlingText || '').trim()
  if (!handling) return ''
  const parts = handling.split('处理意见：')
  const tail = parts[parts.length - 1].trim()
  return clipText(tail)
}

/**
 * G-pass 工单画像（分栏材料）。
 * @param {unknown} recordInput
 * @returns {{ painPoint: string, customerRequest: string, handlingConclusion: string, requestScene: string, problemType: string, journeyL1: string }}
 */
export function buildGeneralizationEvidence(recordInput) {
  const record = /** @type {Record<string, unknown>} */ (
    recordInput && typeof recordInput === 'object' ? recordInput : {}
  )
  return {
    painPoint: clipText(String(record.painPoint || record.problemSummary || '').trim()),
    customerRequest: clipText(String(record.customerRequest || '').trim(), 200),
    handlingConclusion: extractHandlingConclusion(record),
    requestScene: clipText(String(record.requestScene || '').trim(), 40),
    problemType: clipText(
      [record.problemType, record.problemTypeL1, record.problemTypeL2]
        .map((t) => String(t || '').trim())
        .filter(Boolean)
        .join('/'),
      40,
    ),
    journeyL1: clipText(String(record.journeyL1 || '').trim(), 40),
  }
}

/**
 * G-pass strict prompt 构造。
 * @param {{ evidence: ReturnType<typeof buildGeneralizationEvidence>, productName: string }} params
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildGeneralizationJudgePrompt({ evidence, productName }) {
  const categoryList = GENERALIZATION_CATEGORIES.map((c) => `- ${c}`).join('\n')
  const systemPrompt = `你是移动云产品用户反馈分析助手。判断一条投诉/咨询工单暴露的问题是否值得"举一反三"（纳入共性问题系统性排查）。
只返回 JSON：{"needsGeneralization":"yes"|"no","category":"<范畴枚举值，no 时空>","scope":"multi_scenario"|"cross_product","confidence":"high"|"medium"|"low","reason":"一句话理由"}
判定标准（两条判据，均须满足才判 yes）：
- 判据 A（共性）：问题场景或出错原因具备跨场景/跨产品的共性——同类问题会在其他场景/产品再现，而非单产品偶发特例。scope 反映共性范围：多场景共性=multi_scenario；跨产品共性（非单产品特例）=cross_product。
- 判据 B（可介入）：问题根因落在可介入范畴内（下方六选一，只选不造，不得发明新值）：
${categoryList}
- 纯客户侧原因不算可介入：客户自己配置错误、客户理解偏差、客户侧环境问题等——产品侧没有可改进动作，判 no。
- confidence 表达把握程度：根因陈述明确且明确属某范畴=high；根因可推断但表述含糊=medium；仅猜测=low。
- 理由必须引用工单材料中的具体依据（如处理意见里的根因结论），不得泛泛而谈。
- 犹豫时判 no（宁漏勿错——一次假建议的代价是人工忽略，一次漏判才是漏掉真共性问题）。`

  const userPrompt = `产品：${productName}

【工单材料】
${evidence.painPoint ? `（需求痛点）${evidence.painPoint}` : ''}
${evidence.customerRequest ? `（客户请求）${evidence.customerRequest}` : ''}
${evidence.handlingConclusion ? `（处理意见结论）${evidence.handlingConclusion}` : ''}
${evidence.requestScene || evidence.problemType || evidence.journeyL1 ? `（辅助维度）${[evidence.requestScene, evidence.problemType, evidence.journeyL1].filter(Boolean).join(' · ')}` : ''}

这条工单暴露的问题是否需要举一反三？`

  return { systemPrompt, userPrompt }
}

/**
 * 解析 LLM 返回（strict）。失败/非法值返回 null。
 * @param {unknown} data - llmChatCompletion 响应
 * @returns {{ needsGeneralization: 'yes' | 'no', category: string, scope: '' | 'multi_scenario' | 'cross_product', confidence: 'high' | 'medium' | 'low', reason: string } | null}
 */
export function parseGeneralizationJudgeResult(data) {
  let parsed
  try {
    parsed = parseLlmMessageContent(getLlmCompletionText(data))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const needs = String(parsed.needsGeneralization || '').trim()
  if (needs !== 'yes' && needs !== 'no') return null
  const confidenceRaw = String(parsed.confidence || '').trim()
  const confidence =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? /** @type {'high' | 'medium' | 'low'} */ (confidenceRaw)
      : 'low'
  // category/scope：yes 时必须是合法枚举（只选不造）；no 时清空
  const categoryRaw = String(parsed.category || '').trim()
  const scopeRaw = String(parsed.scope || '').trim()
  if (needs === 'yes') {
    if (!GENERALIZATION_CATEGORIES.includes(/** @type {any} */ (categoryRaw))) return null
    if (!GENERALIZATION_SCOPES.includes(/** @type {any} */ (scopeRaw))) return null
  }
  const reason = String(parsed.reason || '').trim().slice(0, 200)
  return {
    needsGeneralization: needs,
    category: needs === 'yes' ? categoryRaw : '',
    scope: needs === 'yes' ? /** @type {'multi_scenario' | 'cross_product'} */ (scopeRaw) : '',
    confidence,
    reason,
  }
}

/**
 * 判定门槛：yes 且 confidence ≥ medium 才产出 hint。
 * @param {{ needsGeneralization: string, confidence: string }} result
 */
export function passesGeneralizationJudgeGate(result) {
  return (
    result?.needsGeneralization === 'yes' &&
    (result.confidence === 'high' || result.confidence === 'medium')
  )
}

/**
 * G-pass 单条判定入口（G2-4 的 scanRunner 按批调用）。
 *
 * @param {Object} params
 * @param {unknown} params.record - 完整工单记录
 * @param {string} params.productName
 * @param {import('../storage.js').AppSettings | null} [params.settings]
 * @param {{ llm?: typeof llmChatCompletion }} [params.deps] - 测试注入
 * @returns {Promise<{ needsGeneralization: 'yes' | 'no', category: string, scope: string, confidence: 'high' | 'medium' | 'low', reason: string, promptVersion: string } | null>}
 *   null = 不落 hint（no/low/解析失败/画像缺失）
 */
export async function judgeGeneralizationForRecord(params) {
  const { record, productName, settings = null } = params
  const llm = params.deps?.llm || llmChatCompletion
  const evidence = buildGeneralizationEvidence(record)
  if (!evidence.painPoint && !evidence.handlingConclusion) return null // 无判别材料

  try {
    const { systemPrompt, userPrompt } = buildGeneralizationJudgePrompt({
      evidence,
      productName,
    })
    const data = await llm(settings, {
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    const parsed = parseGeneralizationJudgeResult(data)
    if (!parsed) return null
    return { ...parsed, promptVersion: GENERALIZATION_PROMPT_VERSION }
  } catch {
    // G-pass 无字面降级（判据 B 语义性强——DESIGN §3.1）；LLM 异常静默跳过
    return null
  }
}
