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

/**
 * 将快照 generatedAt（ISO/UTC）格式化为本地时间，避免页面直接截断 UTC 字符串后看起来偏几个小时。
 * @param {string | null | undefined} generatedAt
 */
export function formatSnapshotGeneratedAt(generatedAt) {
  if (!generatedAt) return ''
  const date = new Date(generatedAt)
  if (Number.isNaN(date.getTime())) return String(generatedAt)
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })
}
