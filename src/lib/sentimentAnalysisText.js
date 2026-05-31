/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * 情绪分析语料：以客户请求内容、需求痛点为准（不再依赖 customerQuote 抽取）
 *
 * @param {Partial<FeedbackRecord> | { customerRequest?: string; painPoint?: string; problemSummary?: string; customerQuote?: string; rawText?: string; handlingText?: string }} record
 */
export function buildSentimentAnalysisText(record) {
  /** @type {string[]} */
  const parts = []
  const request = record?.customerRequest?.trim()
  const pain = (record?.painPoint || record?.problemSummary || '').trim()
  if (request) parts.push(request)
  if (pain && pain !== request) parts.push(pain)
  if (parts.length) return parts.join('\n')

  return (
    record?.customerQuote?.trim() ||
    record?.rawText?.trim() ||
    record?.handlingText?.trim() ||
    ''
  )
}
