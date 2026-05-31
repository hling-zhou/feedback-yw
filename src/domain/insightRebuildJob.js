/** @typedef {typeof INSIGHT_REBUILD_JOB_STATUSES[number]} InsightRebuildJobStatus */

export const INSIGHT_REBUILD_JOB_STATUSES = /** @type {const} */ ([
  'queued',
  'running',
  'succeeded',
  'failed',
  'cancelled',
])

/**
 * @typedef {Object} InsightRebuildJobProgress
 * @property {number} done
 * @property {number} total
 * @property {string | null} [stage]
 */

/**
 * @typedef {Object} InsightRebuildJob
 * @property {string} id
 * @property {string} insightPeriodId
 * @property {InsightRebuildJobStatus} status
 * @property {InsightRebuildJobProgress} progress
 * @property {string} [idempotencyKey]
 * @property {string} [triggeredBy]
 * @property {string} [errorSummary]
 * @property {string} schemaVersion
 * @property {string} createdAt
 * @property {string} [startedAt]
 * @property {string} [finishedAt]
 * @property {number} [durationMs]
 */

/**
 * @param {string} insightPeriodId
 */
export function buildInsightRebuildIdempotencyKey(insightPeriodId) {
  return `insight-rebuild:${insightPeriodId}`
}

/**
 * @param {Pick<InsightRebuildJob, 'insightPeriodId'> & { triggeredBy?: string; idempotencyKey?: string }} params
 * @returns {InsightRebuildJob}
 */
export function createInsightRebuildJob({ insightPeriodId, triggeredBy, idempotencyKey }) {
  const now = new Date().toISOString()
  return {
    id: `insight-rebuild:${insightPeriodId}:${Date.now()}`,
    insightPeriodId,
    status: 'queued',
    progress: { done: 0, total: 6, stage: null },
    idempotencyKey: idempotencyKey || buildInsightRebuildIdempotencyKey(insightPeriodId),
    triggeredBy,
    schemaVersion: '1',
    createdAt: now,
  }
}

/** @param {InsightRebuildJobStatus} status */
export function isActiveInsightRebuildStatus(status) {
  return status === 'queued' || status === 'running'
}
