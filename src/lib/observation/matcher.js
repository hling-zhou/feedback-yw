import { llmChatCompletion, getLlmCompletionText, parseLlmMessageContent } from '../llmClient.js'
import { keywordsMatch, buildRecallText } from './recall.js'

/**
 * 留观判别 matcher（DESIGN §3.1 步 3 / §3.2 C3）。
 *
 * 两侧画像：
 * - issue 侧：summary（人工描述主锚）+ 代表证据（最新 confirmed 的痛点/原文摘要）+ keywords；
 * - 新记录侧：工单 = 痛点 + 客户请求（处理意见已蒸馏其中；瘦工单兜底带整段处理意见、末段优先）；
 *   评价 = 原文 + 原因标签。
 *
 * 输出：same/not_same + confidence + reason；**same 且 ≥medium 才出建议**（low 拦截）。
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
 * @param {unknown} record
 */
function thinTicketFallback(record) {
  const handling = String(record?.handlingText || '').trim()
  if (!handling) return ''
  const tail = handling.slice(-PROFILE_TEXT_CAP)
  return `（处理意见末段）${tail}`
}

/**
 * 新记录侧画像。
 * @param {unknown} record
 * @returns {{ text: string, thin: boolean }}
 */
export function buildRecordProfile(record) {
  const type = String(record?.dataSourceType || '')
  if (type === 'post_use_rating') {
    const parts = [
      String(record?.commentText || record?.rawText || '').trim(),
      String(record?.lowScoreReason || '').trim() ? `（原因标签）${String(record?.lowScoreReason).trim()}` : '',
    ].filter(Boolean)
    return { text: clipText(parts.join('\n')), thin: false }
  }
  const painPoint = String(record?.painPoint || record?.problemSummary || '').trim()
  const customerRequest = String(record?.customerRequest || '').trim()
  const core = [painPoint, customerRequest].filter(Boolean).join('\n')
  // 瘦工单判定：痛点缺失或过短才兜底（痛点完整时即使短也不算瘦——语义已够 LLM 判别）
  const thin = painPoint.length < THIN_PAINPOINT_THRESHOLD
  const text = thin ? [core, thinTicketFallback(record)].filter(Boolean).join('\n') : core
  return { text: clipText(text), thin }
}

/**
 * issue 侧画像。
 * @param {Object} issue
 * @param {string} issue.title
 * @param {string} issue.summary
 * @param {string[]} [issue.keywords]
 * @param {string} [issue.representativeEvidence] - 调用方取最新 confirmed 证据摘要
 * @param {string} [issue.evidenceKind] - 'ticket' | 'rating' | 'mixed'（跨源判别语域提示用）
 * @returns {string}
 */
export function buildIssueProfile(issue) {
  const parts = [
    `（问题描述）${String(issue?.summary || issue?.title || '').trim()}`,
    issue?.representativeEvidence ? `（代表证据）${String(issue.representativeEvidence).trim()}` : '',
  ].filter(Boolean)
  return clipText(parts.join('\n'))
}

/**
 * strict prompt 构造（只判一个候选，输出单 JSON 对象）。
 * @param {{ issueProfile: string, recordProfile: string, productName: string, crossSource?: boolean }} params
 * @returns {{ systemPrompt: string, userPrompt: string }}
 */
export function buildObservationMatchPrompt({ issueProfile, recordProfile, productName, crossSource }) {
  const systemPrompt = `你是移动云产品用户反馈分析助手。判断一条新反馈与一个"留观问题"是否为同一底层产品问题。
只返回 JSON：{"decision":"same"|"not_same","confidence":"high"|"medium"|"low","reason":"一句话理由"}
规则：
- 只从 same / not_same 中选择，不得发明其他值
- confidence 表达把握程度：措辞与问题本质高度一致=high；语义相近但表述差异大=medium；仅模糊相关=low
- 理由必须具体（说明两者共同的问题本质，而非"都比较类似"）
- ${crossSource ? '跨来源对照：一侧来自工单（书面语），另一侧可能来自用户评价（口语化），判断是否同一底层产品问题，忽略语言风格差异。' : ''}
- 犹豫时判 not_same（宁漏勿错）`

  const userPrompt = `产品：${productName}

【留观问题】
${issueProfile}

【新反馈】
${recordProfile}

这条新反馈是否为该留观问题的又一次出现？`

  return { systemPrompt, userPrompt }
}

/**
 * 解析 LLM 返回（strict；失败按 not_same）。
 * @param {unknown} data - llmChatCompletion 响应
 * @returns {{ decision: 'same' | 'not_same', confidence: 'high' | 'medium' | 'low', reason: string } | null}
 */
export function parseObservationMatchResult(data) {
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
export function scoreObservationFallback(issue, recallText) {
  const text = String(recallText || '')
  if (!text.trim()) return null
  const kwHit = keywordsMatch(text, issue?.keywords || [])
  const summaryHit = (() => {
    const summary = String(issue?.summary || issue?.title || '').trim()
    if (!summary) return false
    // 摘要去标点后按 2 字滑窗找重叠片段（≥4 连续字视为字面重叠）
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
    // 无 keywords 的 issue 依赖描述字面重叠（4+ 连续字）兜底
    return { decision: 'same', confidence: 'medium', reason: '降级判别：问题描述字面重叠' }
  }
  return null // 字面弱信号不出建议（宁漏勿错）
}

/**
 * 判别门槛：same 且 ≥medium 才出建议。
 * @param {{ decision: string, confidence: string }} result
 */
export function passesObservationGate(result) {
  return result?.decision === 'same' && (result.confidence === 'high' || result.confidence === 'medium')
}

/**
 * 单对判别入口。
 *
 * @param {Object} params
 * @param {Object} params.issue - { issueId, title, summary, keywords, representativeEvidence }
 * @param {unknown} params.record - 完整记录
 * @param {string} params.productName
 * @param {import('../storage.js').AppSettings | null} [params.settings]
 * @param {boolean} [params.crossSource] - 跨源补射（置信度封顶 medium）
 * @param {{ llm?: typeof llmChatCompletion }} [params.deps] - 测试注入
 * @returns {Promise<{ decision: 'same' | 'not_same', confidence: 'high' | 'medium' | 'low', reason: string, source: 'llm' | 'fallback' } | null>}
 *   null = 不出建议（low/not_same/无信号）
 */
export async function matchObservationIssue(params) {
  const { issue, record, productName, settings = null, crossSource = false } = params
  const llm = params.deps?.llm || llmChatCompletion
  const recordProfile = buildRecordProfile(record)
  const issueProfile = buildIssueProfile(issue)
  if (!recordProfile.text || !issueProfile) return null
  const recallText = buildRecallText(record)

  let llmError = false
  let llmResult = null
  try {
    const { systemPrompt, userPrompt } = buildObservationMatchPrompt({
      issueProfile,
      recordProfile: recordProfile.text,
      productName,
      crossSource,
    })
    const data = await llm(settings, {
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
    })
    llmResult = parseObservationMatchResult(data)
  } catch {
    llmError = true
  }

  if (llmResult) {
    let confidence = llmResult.confidence
    if (crossSource && confidence === 'high') confidence = 'medium' // 跨源封顶
    const reason = (crossSource ? '【跨源】' : '') + (llmResult.reason || '')
    if (llmResult.decision === 'same') {
      return { decision: 'same', confidence, reason, source: 'llm' }
    }
    return { decision: 'not_same', confidence, reason, source: 'llm' }
  }

  if (!llmError) return null // LLM 正常返回但解析失败 → 宁漏勿错

  // LLM 不可用 → 降级
  const fallback = scoreObservationFallback(issue, recallText)
  if (!fallback) return null
  return { ...fallback, source: 'fallback' }
}
