/**
 * 用后即评双文件导入会话：解析 → 明细落库 → 投诉回访双写补全工单
 */
import { randomId } from '../randomId.js'
import {
  parseSmsChannelWorkbook,
  parseOfficialChannelWorkbook,
  buildMergedPostUseRows,
} from './parseChannels.js'
import { buildPostUseRatingRecords } from './buildRecords.js'
import {
  computeExternalMixedMetrics,
  computeInternalExperienceMetrics,
  computeInternalSatisfactionMetrics,
} from './metrics.js'
import { getPostUseRatingProductNames } from '../productCatalog/postUseRatingProducts.js'
import { processFollowUpSatisfactionImportRows } from '../followUpSatisfactionImport.js'
import { persistPostUseTrendForMonth } from './trendStore.js'
import { aggregateOptionReasons, toTrendReasonRows } from './reasonStats.js'
import { getCatalogProducts } from '../productCatalogLoader.js'
import { isApiStorageAdapter } from '../../storage/feedbackStore.js'
import { importFollowUpSatisfaction } from '../followUpSatisfactionClient.js'
import { periodIdFromImportMonth } from '../../domain/postUseRatingImport.js'

/**
 * 将 executePostUseChannelImport 的 phase 映射为导入会话进度文案
 * @param {{ phase: string; detail?: string }} p
 */
export function formatPostUseChannelImportProgress(p) {
  const detail = p.detail ? ` (${p.detail})` : ''
  switch (p.phase) {
    case 'parse':
      return '正在解析双文件…'
    case 'put_records':
      return `正在写入明细${detail}…`
    case 'follow_up_enrich':
      return `正在补全投诉回访${detail}…`
    case 'sync':
      return '正在同步数据…'
    case 'snapshot':
      return '正在生成该数据月份的洞察快照…'
    case 'done':
      return '导入收尾中…'
    default:
      return p.phase ? `正在处理：${p.phase}${detail}` : '正在导入用后即评…'
  }
}

export const POST_USE_CHANNEL_IMPORT_SESSION_LABEL = '用后即评双文件'

/**
 * @param {ArrayBuffer} smsBuffer
 * @param {ArrayBuffer} officialBuffer
 * @param {{ importMonth: string; catalogProducts?: import('../productCatalogLoader.js').CatalogProduct[] }} opts
 */
export function previewPostUseChannelImport(smsBuffer, officialBuffer, opts) {
  const sms = parseSmsChannelWorkbook(smsBuffer)
  const official = parseOfficialChannelWorkbook(officialBuffer)
  if (sms.error) throw new Error(sms.error)
  if (official.error) throw new Error(official.error)

  const merged = buildMergedPostUseRows({
    smsRows: sms.rows,
    consoleRows: official.score?.rows || [],
    callbackRows: official.callback?.rows || [],
    optionRows: official.option?.rows || [],
  })

  const productNames = getPostUseRatingProductNames(
    opts.catalogProducts || getCatalogProducts(),
  )
  const internalExp = computeInternalExperienceMetrics(merged.scored, { productNames })
  const internalSat = computeInternalSatisfactionMetrics(merged.scored, { productNames })
  const external = computeExternalMixedMetrics(merged.scored, { productNames })

  return {
    sms,
    official,
    merged,
    metrics: { internalExp, internalSat, external },
    productNames,
  }
}

/**
 * @param {Object} params
 * @param {import('../../storage/getStorageAdapter.js').StorageAdapter} params.adapter
 * @param {ArrayBuffer} params.smsBuffer
 * @param {ArrayBuffer} params.officialBuffer
 * @param {string} params.importMonth
 * @param {string} [params.smsFileName]
 * @param {string} [params.officialFileName]
 * @param {boolean} [params.dryRun]
 * @param {(p: { phase: string; detail?: string }) => void} [params.onProgress]
 */
export async function executePostUseChannelImport(params) {
  const {
    adapter,
    smsBuffer,
    officialBuffer,
    importMonth,
    smsFileName = '短信渠道.xls',
    officialFileName = '官网渠道.xls',
    dryRun = false,
    onProgress,
  } = params

  onProgress?.({ phase: 'parse' })
  const preview = previewPostUseChannelImport(smsBuffer, officialBuffer, {
    importMonth,
    catalogProducts: getCatalogProducts(),
  })

  const importBatchId = `pur_${importMonth}_${randomId().slice(0, 8)}`
  const importedAt = new Date().toISOString()
  const records = buildPostUseRatingRecords(preview.merged.scored, {
    importMonth,
    importBatchId,
    importBatchName: `用后即评-${importMonth}`,
    importFileName: `${smsFileName}+${officialFileName}`,
    importedAt,
  })

  const callbackRawRows = preview.official.callback?.rows || []

  if (dryRun) {
    return {
      dryRun: true,
      importBatchId,
      recordCount: records.length,
      counts: preview.merged.counts,
      metrics: preview.metrics,
      followUpPreview: null,
    }
  }

  onProgress?.({ phase: 'put_records', detail: String(records.length) })

  await adapter.init?.()
  const listed = await adapter.listRecords({ dataSourceType: 'post_use_rating' })
  const existing = listed?.records || []
  const toDelete = existing.filter(
    (r) =>
      r.importMonth === importMonth &&
      (r.sourceSubType === 'sms_survey' ||
        r.sourceSubType === 'web_survey' ||
        r.sourceSubType === 'satisfaction_callback' ||
        r.channel === 'sms' ||
        r.channel === 'console' ||
        r.channel === 'callback'),
  )
  for (const rec of toDelete) {
    await adapter.deleteRecord(rec.id)
  }

  await adapter.putRecords(records)

  onProgress?.({ phase: 'follow_up_enrich', detail: String(callbackRawRows.length) })
  let followUpResult = null
  if (callbackRawRows.length) {
    if (isApiStorageAdapter(adapter)) {
      followUpResult = await importFollowUpSatisfaction({
        importMonth,
        insightPeriodId: periodIdFromImportMonth(importMonth),
        importBatchId,
        dryRun: false,
        rows: callbackRawRows,
      })
    } else {
      const ticketListed = await adapter.listRecords({})
      const tickets = (ticketListed?.records || []).filter(
        (r) =>
          r.dataSourceType === 'complaint_ticket' || r.dataSourceType === 'consultation_ticket',
      )
      const processed = processFollowUpSatisfactionImportRows(callbackRawRows, tickets, {
        importMonth,
        importBatchId,
        importedAt,
      })
      if (processed.updatedRecords?.length) {
        await adapter.putRecords(processed.updatedRecords)
      }
      followUpResult = processed
    }
  }

  onProgress?.({ phase: 'done' })
  try {
    const reasonAgg = aggregateOptionReasons(
      [
        ...(preview.merged.options || []),
        ...(preview.merged.scored || []).filter(
          (r) =>
            (r.channel === 'console' || r.channel === 'callback') &&
            Number.isFinite(r.score) &&
            r.score < 10,
        ),
      ],
      { productNames: preview.productNames },
    )
    await persistPostUseTrendForMonth(
      adapter,
      importMonth,
      preview.metrics,
      toTrendReasonRows(reasonAgg, importMonth),
    )
  } catch {
    // 趋势写入失败不阻断主导入
  }
  return {
    dryRun: false,
    importBatchId,
    recordCount: records.length,
    counts: preview.merged.counts,
    metrics: preview.metrics,
    followUpResult,
    deletedPrior: toDelete.length,
  }
}
