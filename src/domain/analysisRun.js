/** @typedef {import('./enums.js').AnalysisRunStatus} AnalysisRunStatus */
/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} AnalysisRunFailure
 * @property {number} [rowIndex]
 * @property {string} [recordId]
 * @property {string} code
 * @property {string} message
 */

/**
 * @typedef {Object} AnalysisRun
 * @property {string} id
 * @property {string} tenantId
 * @property {string} insightPeriodId
 * @property {DataSourceType} dataSourceType
 * @property {string} [importBatchId]
 * @property {string} idempotencyKey
 * @property {AnalysisRunStatus} status
 * @property {string} schemaVersion
 * @property {string} pipelineVersion
 * @property {string} tagLibraryVersion
 * @property {number} total
 * @property {number} successCount
 * @property {number} failureCount
 * @property {string[]} [successRecordIds]
 * @property {AnalysisRunFailure[]} [failures]
 * @property {string} [errorSummary]
 * @property {number} [llmCalls]
 * @property {number} [llmTokensIn]
 * @property {number} [llmTokensOut]
 * @property {string} startedAt
 * @property {string} [finishedAt]
 * @property {number} [durationMs]
 */

/**
 * @typedef {Object} RecordArtifact
 * @property {string} id
 * @property {string} runId
 * @property {string} recordId
 * @property {'record'} artifactType
 * @property {object} [localTags]
 * @property {object} [mergedTags]
 * @property {string} [mergeReason]
 * @property {number} [confidence]
 * @property {string} inputTextHash
 * @property {string} [excerpt]
 */

/**
 * @typedef {Object} RunArtifact
 * @property {string} id
 * @property {string} runId
 * @property {'run'} artifactType
 * @property {object} paramsSnapshot
 * @property {string} [fileSha256]
 */

/**
 * @param {Pick<AnalysisRun, 'insightPeriodId' | 'dataSourceType' | 'importBatchId'> & { fileSha256?: string }} params
 */
export function buildIdempotencyKey({ insightPeriodId, dataSourceType, importBatchId, fileSha256 }) {
  const batch = importBatchId || 'no-batch'
  const hash = fileSha256 || 'no-file'
  return `${insightPeriodId}|${dataSourceType}|${batch}|${hash}`
}
