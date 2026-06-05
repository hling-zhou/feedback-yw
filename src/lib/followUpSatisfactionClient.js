import { apiFetch } from './apiClient.js'

/**
 * @typedef {import('./followUpSatisfactionImport.js').FollowUpImportUnmatchedRow} FollowUpImportUnmatchedRow
 * @typedef {import('./followUpSatisfactionImport.js').FollowUpImportWarning} FollowUpImportWarning
 */

/**
 * @typedef {Object} FollowUpSatisfactionImportPayload
 * @property {string} importMonth YYYY-MM
 * @property {string} [insightPeriodId]
 * @property {string} [importBatchId]
 * @property {boolean} [dryRun]
 * @property {Record<string, string>[]} rows
 */

/**
 * @typedef {Object} FollowUpSatisfactionImportSummary
 * @property {boolean} ok
 * @property {boolean} dryRun
 * @property {number} appliedRowCount
 * @property {number} skippedNotSuccessful
 * @property {number} skippedInvalidScore
 * @property {number} updatedRecordCount
 * @property {number} outOfPeriodCount
 * @property {number} overwrittenCount
 * @property {number} idempotentUpdateCount
 * @property {FollowUpImportUnmatchedRow[]} unmatched
 * @property {FollowUpImportWarning[]} warnings
 */

/**
 * @param {FollowUpSatisfactionImportPayload} payload
 * @returns {Promise<FollowUpSatisfactionImportSummary>}
 */
export async function importFollowUpSatisfaction(payload) {
  return apiFetch('/api/storage/follow-up-satisfaction/import', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
