/** @typedef {'rule' | 'llm'} TicketAnalysisFieldSource */

export const TICKET_ANALYSIS_SOURCE_LABELS = {
  rule: '规则',
  llm: '大模型',
}

/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

const TICKET_LIKE_SOURCES = /** @type {const} */ (['complaint_ticket', 'consultation_ticket'])

/**
 * 投诉/咨询工单是否仍缺 LLM 增强（任一：客户请求 / 痛点 / 优化建议 非 llm）
 * @param {FeedbackRecord | null | undefined} record
 */
export function recordNeedsTicketLlmEnrichment(record) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  if (getCustomerRequestSource(record) !== 'llm') return true
  if (getPainPointSource(record) !== 'llm') return true
  if (getOptimizationSource(record) === 'manual') return false
  if (getOptimizationSource(record) !== 'llm') return true
  return false
}

/**
 * 投诉/咨询工单是否已完成 LLM 三件套增强
 * @param {FeedbackRecord | null | undefined} record
 */
export function recordHasFullTicketLlmEnrichment(record) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  return !recordNeedsTicketLlmEnrichment(record)
}

/**
 * @param {FeedbackRecord[]} records
 */
export function countRecordsNeedingTicketLlmEnrichment(records) {
  if (!records?.length) return 0
  return records.filter(recordNeedsTicketLlmEnrichment).length
}

/**
 * @param {TicketAnalysisFieldSource | string | undefined | null} source
 */
export function getTicketAnalysisSourceLabel(source) {
  if (!source) return TICKET_ANALYSIS_SOURCE_LABELS.rule
  return TICKET_ANALYSIS_SOURCE_LABELS[source] || String(source)
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getPainPointSource(record) {
  return record?.painPointSource === 'llm' ? 'llm' : 'rule'
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getCustomerRequestSource(record) {
  return record?.customerRequestSource === 'llm' ? 'llm' : 'rule'
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getOptimizationSource(record) {
  if (record?.manualReviewOptimization?.trim()) return 'manual'
  return record?.optimizationSource === 'llm' ? 'llm' : 'rule'
}

/**
 * @param {'rule' | 'llm' | 'manual'} source
 */
export function getOptimizationSourceLabel(source) {
  if (source === 'manual') return '人工复核'
  return getTicketAnalysisSourceLabel(source)
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getDisplayCustomerRequest(record) {
  return record?.customerRequest?.trim() || ''
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getDisplayPainPoint(record) {
  return record?.painPoint?.trim() || record?.problemSummary?.trim() || ''
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function formatListOptimizationPreview(record) {
  const product = record?.optimizationProduct?.trim()
  const service = record?.optimizationService?.trim()
  if (product && service) return `${product}；${service}`
  return product || service || record?.optimizationSuggestion?.trim() || ''
}
