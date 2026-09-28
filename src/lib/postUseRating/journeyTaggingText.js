import { normalizeEvidenceText } from './evidence.js'
import { isValidCustomerText } from './reasonTaxonomy.js'

const SCENE_PLACEHOLDERS = new Set(['未提供', '未分类'])

/**
 * 丢掉占位后的一段语料。空串表示不进入打标文本。
 * @param {unknown} value
 */
function keepJourneyText(value) {
  const text = normalizeEvidenceText(value)
  if (!text || SCENE_PLACEHOLDERS.has(text)) return ''
  if (!isValidCustomerText(text)) return ''
  return text
}

/**
 * 用后即评旅程语料。
 * 顺序：场景、触点页面、问卷名、有效客户回答、不满原因、补充评价。
 * 不用投诉咨询的请求场景、问题类型、处理意见，也不用六组通用关键词。
 * @param {object | null | undefined} record
 */
export function buildPostUseJourneyTaggingText(record) {
  /** @type {string[]} */
  const parts = []
  const push = (value) => {
    const text = keepJourneyText(value)
    if (!text || parts.includes(text)) return
    parts.push(text)
  }

  push(record?.scene)
  if (record?.originalScene && record.originalScene !== record?.scene) {
    push(record.originalScene)
  }
  push(record?.touchpointPageName)
  push(record?.surveyName)

  const reasons = Array.isArray(record?.feedbackReasonTexts) ? record.feedbackReasonTexts : []
  if (reasons.length) {
    for (const reason of reasons) push(reason)
  } else {
    push(record?.feedbackReasonPrimary)
    push(record?.feedbackReasonSecondary)
    push(record?.feedbackReasonTertiary)
  }

  push(record?.lowScoreReason)
  push(record?.commentText)
  push(record?.customerQuote)
  push(record?.rawText)
  return parts.join('\n')
}
