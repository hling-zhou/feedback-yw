/** @typedef {'rule' | 'llm'} TicketAnalysisFieldSource */

import { recordHasUnknownJourney } from '../journeySemantic.js'
import { resolveJourneyLlmSkipScoreThreshold } from '../journeyMatchConfidence.js'

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
 * 投诉/咨询工单是否仍待旅程 LLM 增强（门控高置信 rule 跳过视为已完成）。
 * @param {FeedbackRecord | null | undefined} record
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function recordNeedsJourneyLlmEnrichment(record, settings) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  if (record?.journeySource === 'llm') return false

  const threshold = resolveJourneyLlmSkipScoreThreshold(settings)
  const score = record?.journeyMatchScore
  if (
    record?.journeySource === 'rule' &&
    typeof score === 'number' &&
    score >= threshold &&
    !recordHasUnknownJourney(record)
  ) {
    return false
  }

  return true
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function recordHasJourneyLlmEnrichment(record, settings) {
  const ds = record?.dataSourceType || 'complaint_ticket'
  if (!TICKET_LIKE_SOURCES.includes(ds)) return false
  return !recordNeedsJourneyLlmEnrichment(record, settings)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function countRecordsNeedingJourneyLlmEnrichment(records, settings) {
  if (!records?.length) return 0
  return records.filter((r) => recordNeedsJourneyLlmEnrichment(r, settings)).length
}

/**
 * @param {FeedbackRecord[]} before
 * @param {FeedbackRecord[]} after
 * @param {import('../storage.js').AppSettings} [settings]
 */
export function computeJourneyEnrichmentDelta(before, after, settings) {
  let completed = 0
  let skippedByGating = 0
  for (let i = 0; i < after.length; i++) {
    const prev = before[i]
    const next = after[i]
    if (next.journeySource === 'llm' && prev.journeySource !== 'llm') {
      completed++
      continue
    }
    if (
      next.journeySource === 'rule' &&
      recordNeedsJourneyLlmEnrichment(prev, settings) &&
      !recordNeedsJourneyLlmEnrichment(next, settings)
    ) {
      skippedByGating++
    }
  }
  return { journeyLlmCompleted: completed, journeySkippedByGating: skippedByGating }
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
