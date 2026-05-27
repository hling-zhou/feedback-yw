/** @typedef {import('./enums.js').SnapshotStatus} SnapshotStatus */
/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} InsightSnapshot
 * @property {string} id
 * @property {string} tenantId
 * @property {string} insightPeriodId
 * @property {DataSourceType} dataSourceType
 * @property {SnapshotStatus} status
 * @property {string} schemaVersion
 * @property {string} pipelineVersion
 * @property {string} tagLibraryVersion
 * @property {string} generatedAt
 * @property {Record<string, unknown>} summary
 * @property {Record<string, unknown>} aggregates
 * @property {string[]} recordIds
 * @property {string} [errorSummary]
 */

/**
 * @typedef {import('./overviewConclusions.js').OverviewConclusions} OverviewConclusions
 */

/**
 * @typedef {Object} OverviewSnapshot
 * @property {string} id
 * @property {string} tenantId
 * @property {string} insightPeriodId
 * @property {SnapshotStatus} status
 * @property {string} schemaVersion
 * @property {string} generatedAt
 * @property {Record<DataSourceType, Record<string, unknown>>} sourceSummaries
 * @property {Record<string, unknown>} crossSourceMetrics
 * @property {OverviewConclusions} [conclusions]
 * @property {string} [errorSummary]
 */

/**
 * @param {DataSourceType} dataSourceType
 * @param {string} insightPeriodId
 */
export function sourceSnapshotId(dataSourceType, insightPeriodId) {
  return `snapshot:${insightPeriodId}:${dataSourceType}`
}

/** @param {string} insightPeriodId */
export function overviewSnapshotId(insightPeriodId) {
  return `overview:${insightPeriodId}`
}
