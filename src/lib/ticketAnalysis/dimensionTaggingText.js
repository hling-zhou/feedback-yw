import {
  extractAcceptanceTextFromFields,
  extractAppendTextFromFields,
  extractHandlingTextFromFields,
} from '../taggingText.js'
import { stripTaggingNoise } from './workflowTextCleanup.js'
import { extractVerifiedSupplementSignals } from './handlingSignalExtract.js'

/**
 * @param {Object} input
 * @param {string} [input.rawText]
 * @param {string} [input.handlingText]
 * @param {string} [input.customerQuote]
 * @param {Record<string, string>} [input.sourceColumns]
 * @returns {{ primaryText: string; secondaryText: string; fullText: string }}
 */
export function buildDimensionTaggingLayers(input) {
  const fields = {
    rawText: input.rawText,
    handlingText: input.handlingText,
    customerQuote: input.customerQuote,
    sourceColumns: input.sourceColumns,
  }

  const acceptance = stripTaggingNoise(extractAcceptanceTextFromFields(fields))
  const append = stripTaggingNoise(extractAppendTextFromFields(fields))
  const handling = stripTaggingNoise(extractHandlingTextFromFields(fields))

  /** @type {string[]} */
  const primaryParts = []
  if (acceptance) primaryParts.push(acceptance)
  if (append && append !== acceptance) primaryParts.push(append)

  const primaryText = primaryParts.join('\n')
  const secondaryText = handling && handling !== primaryText ? handling : ''
  const fullText = [primaryText, secondaryText].filter(Boolean).join('\n\n')

  return { primaryText, secondaryText, fullText }
}

/**
 * 维度打标语料：优先 customerRequest + painPoint；无则回退受理/追加/处理意见
 *
 * 当 CR + painPoint 有值时，额外从处理意见中提取经质量筛选+交叉验证后的
 * 补全信号（工单标题/请求节点中存在但 CR 缺失、且处理意见结论方向一致的），
 * 追加到分类语料末尾——不改 customerRequest 字段本身，只补全分类器可见的语料。
 *
 * @param {Object} input
 * @param {string} [input.customerRequest]
 * @param {string} [input.painPoint]
 * @param {string} [input.problemSummary]
 * @param {string} [input.rawText]
 * @param {string} [input.handlingText]
 * @param {string} [input.customerQuote]
 * @param {Record<string, string>} [input.sourceColumns]
 */
export function buildDimensionTaggingText(input = {}) {
  /** @type {string[]} */
  const parts = []
  const request = input.customerRequest?.trim()
  const pain = (input.painPoint || input.problemSummary || '').trim()

  if (request) parts.push(request)
  if (pain && pain !== request) parts.push(pain)
  if (parts.length) {
    // 处理意见质量筛选 → 结论方向 → 与结构信号交叉验证 → 追加可信信号
    const supplement = extractVerifiedSupplementSignals({
      rawText: input.rawText,
      handlingText: input.handlingText,
      customerRequest: request,
    })
    if (supplement) parts.push(`[结构信号] ${supplement}`)
    return parts.join('\n')
  }

  const layers = buildDimensionTaggingLayers(input)
  return (
    layers.fullText ||
    input.rawText?.trim() ||
    input.handlingText?.trim() ||
    input.customerQuote?.trim() ||
    ''
  )
}

/** @deprecated 使用 {@link buildDimensionTaggingText} */
export function buildProblemTypeTaggingText(input = {}) {
  return buildDimensionTaggingText(input)
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 * @param {{ llmCorpusOnly?: boolean }} [options]
 */
export function buildDimensionTaggingTextForRecord(record, options = {}) {
  const llmCorpusOnly = options.llmCorpusOnly === true
  const hasLlmCorpus =
    record.customerRequestSource === 'llm' || record.painPointSource === 'llm'

  if (llmCorpusOnly) {
    if (!hasLlmCorpus) return ''
    /** @type {string[]} */
    const parts = []
    if (record.customerRequestSource === 'llm' && record.customerRequest?.trim()) {
      parts.push(record.customerRequest.trim())
    }
    const pain = (record.painPoint || record.problemSummary || '').trim()
    if (record.painPointSource === 'llm' && pain && !parts.includes(pain)) {
      parts.push(pain)
    }
    return parts.join('\n')
  }

  return buildDimensionTaggingText({
    customerRequest: record.customerRequest,
    painPoint: record.painPoint,
    problemSummary: record.problemSummary,
    rawText: record.rawText,
    handlingText: record.handlingText,
    customerQuote: record.customerQuote,
    sourceColumns: record.sourceColumns,
  })
}

/**
 * 用户旅程打标语料：有客户请求/痛点时用之，否则回退受理/处理意见。
 * @param {import('../types.js').FeedbackRecord | Record<string, unknown>} record
 */
export function resolveJourneyTaggingText(record = {}) {
  return buildDimensionTaggingTextForRecord(record)
}

/**
 * 全文 taggingText（含处理意见），仅用于问题类型 §3 对端排除等兜底
 *
 * @param {import('../types.js').FeedbackRecord} record
 */
export function buildFullTaggingTextForRecord(record) {
  return buildDimensionTaggingLayers({
    rawText: record.rawText,
    handlingText: record.handlingText,
    customerQuote: record.customerQuote,
    sourceColumns: record.sourceColumns,
  }).fullText || record.rawText?.trim() || record.handlingText?.trim() || ''
}
