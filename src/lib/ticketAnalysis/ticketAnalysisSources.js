/** @typedef {'rule' | 'llm'} TicketAnalysisFieldSource */

export const TICKET_ANALYSIS_SOURCE_LABELS = {
  rule: '规则',
  llm: '大模型',
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
