import { extractAcceptanceTextFromFields } from './taggingText.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * 情绪分析语料：用受理/咨询原话。摘要会删掉情绪词，不拿来判态度。
 * 原话缺失时才退回客户请求和需求痛点。
 *
 * @param {Partial<FeedbackRecord> | { customerRequest?: string; painPoint?: string; problemSummary?: string; customerQuote?: string; rawText?: string; handlingText?: string; sourceColumns?: Record<string, string> }} record
 */
export function buildSentimentAnalysisText(record) {
  const acceptance = extractAcceptanceTextFromFields({
    handlingText: record?.handlingText,
    rawText: record?.rawText,
    customerQuote: record?.customerQuote,
    sourceColumns: record?.sourceColumns,
  })
  if (acceptance) return acceptance

  const quote = record?.customerQuote?.trim()
  if (quote) return quote
  const raw = record?.rawText?.trim()
  if (raw) return raw

  /** @type {string[]} */
  const parts = []
  const request = record?.customerRequest?.trim()
  const pain = (record?.painPoint || record?.problemSummary || '').trim()
  if (request) parts.push(request)
  if (pain && pain !== request) parts.push(pain)
  return parts.join('\n')
}
