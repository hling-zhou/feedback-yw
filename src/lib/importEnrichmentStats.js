import {
  countRecordsNeedingJourneyLlmEnrichment,
  recordNeedsTicketLlmEnrichment,
} from './ticketAnalysis/ticketAnalysisSources.js'

export { computeJourneyEnrichmentDelta } from './ticketAnalysis/ticketAnalysisSources.js'

/**
 * @typedef {Object} ImportEnrichmentStats
 * @property {number} ticketLlmCompleted
 * @property {number} ticketLlmFailed
 * @property {number} journeyLlmCompleted
 * @property {number} journeySkippedByGating
 * @property {number} optimizationRetryCount
 */

/** @returns {ImportEnrichmentStats} */
export function createEmptyEnrichmentStats() {
  return {
    ticketLlmCompleted: 0,
    ticketLlmFailed: 0,
    journeyLlmCompleted: 0,
    journeySkippedByGating: 0,
    optimizationRetryCount: 0,
  }
}

/**
 * @param {import('./types.js').FeedbackRecord[]} before
 * @param {import('./types.js').FeedbackRecord[]} after
 */
export function computeTicketLlmEnrichmentDelta(before, after) {
  let completed = 0
  let failed = 0
  for (let i = 0; i < after.length; i++) {
    const prev = before[i]
    const next = after[i]
    if (!recordNeedsTicketLlmEnrichment(prev)) continue
    if (!recordNeedsTicketLlmEnrichment(next)) completed++
    else failed++
  }
  return { ticketLlmCompleted: completed, ticketLlmFailed: failed }
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function countOptimizationRetries(records) {
  return records.filter((r) => r.optimizationRetry === true).length
}

/**
 * @param {ImportEnrichmentStats} stats
 * @param {number} journeyPendingCount
 * @returns {string[]}
 */
export function buildEnrichmentRetagWarnings(stats, journeyPendingCount = 0) {
  /** @type {string[]} */
  const warnings = []
  if (stats.ticketLlmFailed > 0) {
    warnings.push(
      `${stats.ticketLlmFailed} 条工单的客户请求/痛点/优化建议 LLM 增强未完成。请前往反馈库点击顶部「补打」。`,
    )
  }
  if (journeyPendingCount > 0) {
    warnings.push(
      `${journeyPendingCount} 条工单的用户旅程 LLM 增强未完成。请前往反馈库点击顶部「补打旅程」。`,
    )
  }
  return warnings
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} [settings]
 */
export function countJourneyPendingAfterImport(records, settings) {
  return countRecordsNeedingJourneyLlmEnrichment(records, settings)
}
