import { resolvePeriodFromImportMonth } from '../domain/postUseRatingImport.js'
import { markPeriodSnapshotsStale } from '../snapshots/snapshotService.js'
import { isApiStorageAdapter, persistRecordUpdates } from '../storage/feedbackStore.js'
import { importFollowUpSatisfaction } from './followUpSatisfactionClient.js'
import {
  processFollowUpSatisfactionImportRows,
  summarizeFollowUpImportResult,
} from './followUpSatisfactionImport.js'
import { normalizeImportMonth } from './importUtils.js'
import { fetchAllRecordPages } from './recordLoader.js'

export const FOLLOW_UP_IMPORT_SESSION_LABEL = '满意度回访导入'

/**
 * @param {Object} params
 * @param {import('../storage/adapter.js').StorageAdapter} params.adapter
 * @param {Record<string, string>[]} params.rows
 * @param {string} params.importMonth
 * @param {import('../domain/insightPeriod.js').InsightPeriod[]} params.periods
 */
export async function runFollowUpImportDryRun({ adapter, rows, importMonth, periods }) {
  const importMonthNormalized = normalizeImportMonth(importMonth)
  if (!importMonthNormalized) {
    throw new Error('请选择有效的数据月份（YYYY-MM）')
  }
  const period = resolvePeriodFromImportMonth(importMonthNormalized, periods)
  const payload = {
    importMonth: importMonthNormalized,
    insightPeriodId: period?.id,
    rows,
    dryRun: true,
  }

  if (isApiStorageAdapter(adapter)) {
    return importFollowUpSatisfaction(payload)
  }

  await adapter.init()
  const { records } = await fetchAllRecordPages(adapter)
  const tickets = records.filter(
    (r) =>
      r.dataSourceType === 'complaint_ticket' || r.dataSourceType === 'consultation_ticket',
  )
  return {
    ok: true,
    dryRun: true,
    ...summarizeFollowUpImportResult(
      processFollowUpSatisfactionImportRows(rows, tickets, {
        importMonth: importMonthNormalized,
        period,
      }),
    ),
  }
}

/**
 * @param {Object} params
 * @param {import('../storage/adapter.js').StorageAdapter} params.adapter
 * @param {Record<string, string>[]} params.rows
 * @param {string} params.importMonth
 * @param {import('../domain/insightPeriod.js').InsightPeriod[]} params.periods
 * @param {(uploaded: number, total: number) => void} [params.onUploadProgress]
 */
export async function executeFollowUpImport({
  adapter,
  rows,
  importMonth,
  periods,
  onUploadProgress,
}) {
  const importMonthNormalized = normalizeImportMonth(importMonth)
  if (!importMonthNormalized) {
    throw new Error('请选择有效的数据月份（YYYY-MM）')
  }
  const period = resolvePeriodFromImportMonth(importMonthNormalized, periods)
  const payload = {
    importMonth: importMonthNormalized,
    insightPeriodId: period?.id,
    importBatchId: `follow-up-${importMonthNormalized}-${Date.now()}`,
    rows,
    dryRun: false,
  }

  /** @type {import('./followUpSatisfactionClient.js').FollowUpSatisfactionImportSummary} */
  let summary

  if (isApiStorageAdapter(adapter)) {
    summary = await importFollowUpSatisfaction(payload)
  } else {
    await adapter.init()
    const { records } = await fetchAllRecordPages(adapter)
    const tickets = records.filter(
      (r) =>
        r.dataSourceType === 'complaint_ticket' || r.dataSourceType === 'consultation_ticket',
    )
    const result = processFollowUpSatisfactionImportRows(rows, tickets, {
      importMonth: importMonthNormalized,
      importBatchId: payload.importBatchId,
      period,
    })
    if (result.updatedRecords.length) {
      await persistRecordUpdates(adapter, result.updatedRecords, {
        onProgress: onUploadProgress,
      })
    }
    summary = { ok: true, dryRun: false, ...summarizeFollowUpImportResult(result) }
    if (summary.updatedRecordCount > 0 && period?.id) {
      await markPeriodSnapshotsStale(adapter, period.id)
    }
  }

  return {
    summary,
    dataMonth: importMonthNormalized,
    shouldSync: summary.updatedRecordCount > 0,
  }
}
