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
  const ticketMsg = formatTicketLlmRemainRuleMessage(stats.ticketLlmFailed)
  if (ticketMsg) warnings.push(ticketMsg)
  if (journeyPendingCount > 0) {
    warnings.push(
      `${journeyPendingCount} 条工单的用户旅程 LLM 增强未完成。请前往反馈库点击顶部「补打旅程」。`,
    )
  }
  return warnings
}

export const TICKET_LLM_REMAIN_RULE_LOG_HINT =
  '请在浏览器开发者工具 Network 面板查看 /api/llm/chat 请求，并查看服务端日志。'

/**
 * 导入/补打结束后：仍有工单客户请求或痛点为规则来源时的明确提示。
 * @param {number} failedCount
 * @returns {string}
 */
export function formatTicketLlmRemainRuleMessage(failedCount) {
  if (!failedCount || failedCount <= 0) return ''
  return `打标已完成，但 ${failedCount} 条工单的客户请求/需求痛点仍为「规则」来源（LLM 调用失败或返回空）。${TICKET_LLM_REMAIN_RULE_LOG_HINT}`
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {import('./storage.js').AppSettings} [settings]
 */
export function countJourneyPendingAfterImport(records, settings) {
  return countRecordsNeedingJourneyLlmEnrichment(records, settings)
}
