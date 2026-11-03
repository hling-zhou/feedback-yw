import { llmChatCompletion, getLlmCompletionText, parseLlmMessageContent } from '../llmClient.js'
import { generalizationKeywordsMatch, buildGeneralizationRecallText } from './recall.js'

/**
 * 举一反三判别 matcher（DESIGN-20261102-1.md §3.2 / §3.3）。
 *
 * 拷贝自 src/lib/observation/matcher.js 后全面替换 prompt 为举一反三版
 * （TASKS G2-2：不能 import 留观 matcher——函数名/prompt/门函数全写死"留观"）。
 *
 * 两侧画像：
 * - issue 侧：summary（人工描述主锚）+ 代表证据（最新 confirmed 的痛点摘要）；
 * - 新工单侧：痛点 + 客户请求（处理意见已蒸馏其中；瘦工单兜底带整段处理意见、末段优先）。
 *
 * 输出：same/not_same + confidence + reason；**same 且 ≥medium 才出建议**（low 拦截）。
 * 跨产品命中：match_reason 加「跨产品」前缀（confidence 不封顶——v3.2 定稿，LLM 全库上下文把关）。
 * 降级模式（LLM 不可用）：字面/关键词评分，**永不产 high**。
 * strict JSON 解析失败按 not_same 处理（宁漏勿错）。
 */

/** 画像文本字符上限（控 prompt 体积） */
const PROFILE_TEXT_CAP = 600

/** 瘦工单兜底阈值：痛点为空或过短（<8 字）时带处理意见兜底 */
const THIN_PAINPOINT_THRESHOLD = 8

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
 * 瘦工单兜底：处理意见整段带角色标签，末段优先（结论集中尾部）。
 * @param {Record<string, unknown>} record
 */
function thinTicketFallback(record) {
  const handling = String(record.handlingText || '').trim()
  if (!handling) return ''
  const tail = handling.slice(-PROFILE_TEXT_CAP)
  return `（处理意见末段）${tail}`
}

/**
 * 新工单侧画像（举一反三对象域只有工单——无评价分支）。
 * @param {unknown} recordInput
 * @returns {{ text: string, thin: boolean }}
 */
export function buildGeneralizationRecordProfile(recordInput) {
  const record = /** @type {Record<string, unknown>} */ (
    recordInput && typeof recordInput === 'object' ? recordInput : {}
  )
  const painPoint = String(record.painPoint || record.problemSummary || '').trim()
  const customerRequest = String(record.customerRequest || '').trim()
  const core = [painPoint, customerRequest].filter(Boolean).join('\n')
  const thin = painPoint.length < THIN_PAINPOINT_THRESHOLD
  const text = thin ? [core, thinTicketFallback(record)].filter(Boolean).join('\n') : core
  return { text: clipText(text), thin }
}

/**
 * issue 侧画像。
 * @param {Object} issue
 * @param {string} issue.title
 * @param {string} issue.summary
 * @param {string} [issue.representativeEvidence] - 调用方取最新 confirmed 证据摘要
 * @returns {string}
 */
export function buildGeneralizationIssueProfile(issue) {
  const parts = [
    `（问题描述）${String(issue?.summary || issue?.title || '').trim()}`,
    issue?.representativeEvidence ? `（代表证据）${String(issue.representativeEvidence).trim()}` : '',
  ].filter(Boolean)
  return clipText(parts.join('\n'))
}

/**
 * strict prompt 构造（只判一个候选，输出单 JSON 对象）。
 * 与留观版的本质差异：称谓「举一反三问题」+「同一底层问题模式（可跨产品）」——
 * 跨产品命中是举一反三的核心价值而非噪声（v3.2 全库召回的判别侧配套）。
 * @param {{ issueProfile: string, recordProfile: string, productName: string, crossProduct: boolean }} params
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildGeneralizationMatchPrompt({ issueProfile, recordProfile, productName, crossProduct }) {
  const systemPrompt = `你是移动云产品用户反馈分析助手。判断一条新工单与一个"举一反三问题"是否为同一底层问题模式。
只返回 JSON：{"decision":"same"|"not_same","confidence":"high"|"medium"|"low","reason":"一句话理由"}
规则：
- 只从 same / not_same 中选择，不得发明其他值
- "同一底层问题模式"指问题本质（场景/成因）相同，允许跨产品：产品不同但成因同类（如各产品批量接口都缺事务回滚）也算 same
- ${crossProduct ? '本次对照的两个产品不同：判断是否同一底层问题模式（如同一设计缺陷在不同产品上的表现），忽略产品差异本身。' : ''}
- confidence 表达把握程度：问题本质高度一致=high；语义相近但表述差异大=medium；仅模糊相关=low
- 理由必须具体（说明两者共同的问题本质，而非"都比较类似"）
- 犹豫时判 not_same（宁漏勿错）`

  const userPrompt = `产品：${productName}

【举一反三问题】
${issueProfile}

【新工单】
${recordProfile}

这条新工单是否为该举一反三问题的又一次同类出现？`

  return { systemPrompt, userPrompt }
}

/**
 * 解析 LLM 返回（strict；失败按 not_same）。
 * @param {unknown} data - llmChatCompletion 响应
 * @returns {{ decision: 'same' | 'not_same', confidence: 'high' | 'medium' | 'low', reason: string } | null}
 */
export function parseGeneralizationMatchResult(data) {
  let parsed
  try {
    parsed = parseLlmMessageContent(getLlmCompletionText(data))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const decision = String(parsed.decision || '').trim()
  if (decision !== 'same' && decision !== 'not_same') return null
  const confidenceRaw = String(parsed.confidence || '').trim()
  const confidence =
    confidenceRaw === 'high' || confidenceRaw === 'medium' || confidenceRaw === 'low'
      ? /** @type {'high' | 'medium' | 'low'} */ (confidenceRaw)
      : 'low'
  const reason = String(parsed.reason || '').trim().slice(0, 200)
  return { decision, confidence, reason }
}

/**
 * 降级评分（LLM 不可用）：字面重叠 + 关键词命中；**永不产 high**。
 * @param {{ keywords?: string[], summary?: string, title?: string }} issue
 * @param {string} recallText
 * @returns {{ decision: 'same' | 'not_same', confidence: 'high' | 'medium' | 'low', reason: string } | null}
 */
export function scoreGeneralizationFallback(issue, recallText) {
  const text = String(recallText || '')
  if (!text.trim()) return null
  const kwHit = generalizationKeywordsMatch(text, issue?.keywords || [])
  const summaryHit = (() => {
    const summary = String(issue?.summary || issue?.title || '').trim()
    if (!summary) return false
    const clean = summary.replace(/[，。；、（）\s]/g, '')
    for (let i = 0; i + 4 <= clean.length; i += 1) {
      if (text.includes(clean.slice(i, i + 4))) return true
    }
    return false
  })()
  if (kwHit && summaryHit) {
    return { decision: 'same', confidence: 'medium', reason: '降级判别：关键词与描述字面均命中' }
  }
  if (kwHit) {
    return { decision: 'same', confidence: 'medium', reason: '降级判别：命中维护关键词' }
  }
  if (summaryHit) {
    return { decision: 'same', confidence: 'medium', reason: '降级判别：问题描述字面重叠' }
  }
  return null // 字面弱信号不出建议（宁漏勿错）
}

/**
 * 判别门槛：same 且 ≥medium 才出建议。
 * @param {{ decision: string, confidence: string }} result
 */
export function passesGeneralizationGate(result) {
  return (
    result?.decision === 'same' &&
    (result.confidence === 'high' || result.confidence === 'medium')
  )
}

/**
 * 单对判别入口。
 *
 * @param {Object} params
 * @param {Object} params.issue - { issueId, title, summary, keywords, representativeEvidence }
 * @param {unknown} params.record - 完整工单记录
 * @param {string} params.productName
 * @param {boolean} [params.crossProduct] - 跨产品命中（reason 加前缀；confidence 不封顶——v3.2）
 * @param {import('../storage.js').AppSettings | null} [params.settings]
 * @param {{ llm?: typeof llmChatCompletion }} [params.deps] - 测试注入
 * @returns {Promise<{ decision: 'same' | 'not_same', confidence: 'high' | 'medium' | 'low', reason: string, source: 'llm' | 'fallback' } | null>}
 *   null = 不出建议（low/not_same/无信号）
 */
export async function matchGeneralizationIssue(params) {
  const { issue, record, productName, crossProduct = false, settings = null } = params
  const llm = params.deps?.llm || llmChatCompletion
  const recordProfile = buildGeneralizationRecordProfile(record)
  const issueProfile = buildGeneralizationIssueProfile(issue)
  if (!recordProfile.text || !issueProfile) return null
  const recallText = buildGeneralizationRecallText(record)

  let llmError = false
  let llmResult = null
  try {
    const { systemPrompt, userPrompt } = buildGeneralizationMatchPrompt({
      issueProfile,
      recordProfile: recordProfile.text,
      productName,
      crossProduct,
    })
    const data = await llm(settings, {
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    llmResult = parseGeneralizationMatchResult(data)
  } catch {
    llmError = true
  }

  if (llmResult) {
    // 跨产品前缀（confidence 不封顶——v3.2 定稿）
    const reason = (crossProduct ? '【跨产品】' : '') + (llmResult.reason || '')
    if (llmResult.decision === 'same') {
      return { decision: 'same', confidence: llmResult.confidence, reason, source: 'llm' }
    }
    return { decision: 'not_same', confidence: llmResult.confidence, reason, source: 'llm' }
  }

  if (!llmError) return null // LLM 正常返回但解析失败 → 宁漏勿错

  // LLM 不可用 → 降级
  const fallback = scoreGeneralizationFallback(issue, recallText)
  if (!fallback) return null
  return { ...fallback, source: 'fallback' }
}
