/**
 * 用后即评双文件导入会话：解析 → 明细落库 → 投诉回访双写补全工单
 */
import { randomId } from '../randomId.js'
import {
  parseSmsChannelWorkbook,
  parseOfficialChannelWorkbook,
  buildMergedPostUseRows,
  mergeSmsChannelWorkbooks,
  mergeOfficialChannelWorkbooks,
} from './parseChannels.js'
import { buildPostUseRatingRecords } from './buildRecords.js'
import {
  computeExternalMixedMetrics,
  computeInternalExperienceMetrics,
  computeInternalSatisfactionMetrics,
} from './metrics.js'
import {
  getPostUseRatingProductNames,
  scopePostUseRatingRecords,
} from '../productCatalog/postUseRatingProducts.js'
import { processFollowUpSatisfactionImportRows } from '../followUpSatisfactionImport.js'
import { persistPostUseTrendForMonth } from './trendStore.js'
import { aggregateOptionReasons, toTrendReasonRows } from './reasonStats.js'
import { getCatalogProducts } from '../productCatalogLoader.js'
import { isApiStorageAdapter } from '../../storage/feedbackStore.js'
import { importFollowUpSatisfaction } from '../followUpSatisfactionClient.js'
import { periodIdFromImportMonth } from '../../domain/postUseRatingImport.js'
import { buildPostUsePeriodQuality, persistPostUsePeriodQuality } from './qualityStore.js'

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
 * @param {{ password?: string; retryWithoutPassword?: boolean }} [options]
 * @param {string} channel
 * @param {number} fileIndex
 */
function withChannelParseError(channel, fileIndex, fn) {
  try {
    return fn()
  } catch (err) {
    if (err && typeof err === 'object') {
      // @ts-expect-error runtime-only for Import.jsx password retry
      err.channel = channel
      // @ts-expect-error runtime-only for Import.jsx password retry
      err.fileIndex = fileIndex
    }
    throw err
  }
}

/**
 * @param {ArrayBuffer[]} smsBuffers
 * @param {ArrayBuffer[]} officialBuffers
 * @param {{
 *   importMonth: string
 *   catalogProducts?: import('../productCatalogLoader.js').CatalogProduct[]
 *   smsPasswords?: string[]
 *   officialPasswords?: string[]
 * }} opts
 */
export function previewPostUseChannelImport(smsBuffers, officialBuffers, opts = {}) {
  const smsList = smsBuffers || []
  const officialList = officialBuffers || []
  const smsPasswords = opts.smsPasswords || []
  const officialPasswords = opts.officialPasswords || []

  if (!smsList.length || !officialList.length) {
    throw new Error('请同时选择短信渠道与官网渠道文件')
  }

  const smsParses = smsList.map((buffer, index) =>
    withChannelParseError('sms', index, () =>
      parseSmsChannelWorkbook(buffer, {
        password: smsPasswords[index] || undefined,
        retryWithoutPassword: Boolean(smsPasswords[index]),
      }),
    ),
  )
  const officialParses = officialList.map((buffer, index) =>
    withChannelParseError('official', index, () =>
      parseOfficialChannelWorkbook(buffer, {
        password: officialPasswords[index] || undefined,
        retryWithoutPassword: Boolean(officialPasswords[index]),
      }),
    ),
  )

  const sms = mergeSmsChannelWorkbooks(smsParses)
  const official = mergeOfficialChannelWorkbooks(officialParses)
  if (sms.error) throw new Error(sms.error)
  if (official.error) throw new Error(official.error)

  const merged = buildMergedPostUseRows({
    smsRows: sms.rows,
    consoleRows: official.score?.rows || [],
    callbackRows: official.callback?.rows || [],
    optionRows: official.option?.rows || [],
  })

  const catalogProducts = opts.catalogProducts || getCatalogProducts()
  const productNames = getPostUseRatingProductNames(catalogProducts)
  const analysisRows = scopePostUseRatingRecords(merged.scored, catalogProducts)
  const internalExp = computeInternalExperienceMetrics(analysisRows, { productNames })
  const internalSat = computeInternalSatisfactionMetrics(analysisRows, { productNames })
  const external = computeExternalMixedMetrics(analysisRows, {
    productNames,
    companyRows: merged.scored,
  })

  return {
    sms,
    official,
    merged,
    metrics: { internalExp, internalSat, external },
    analysisRows,
    productNames,
  }
}

/**
 * @param {Object} params
 * @param {import('../../storage/getStorageAdapter.js').StorageAdapter} params.adapter
 * @param {ArrayBuffer[]} params.smsBuffers
 * @param {ArrayBuffer[]} params.officialBuffers
 * @param {string} params.importMonth
 * @param {string[]} [params.smsFileNames]
 * @param {string[]} [params.officialFileNames]
 * @param {string[]} [params.smsPasswords]
 * @param {string[]} [params.officialPasswords]
 * @param {boolean} [params.dryRun]
 * @param {(p: { phase: string; detail?: string }) => void} [params.onProgress]
 */
export async function executePostUseChannelImport(params) {
  const {
    adapter,
    smsBuffers,
    officialBuffers,
    importMonth,
    smsFileNames = ['短信渠道.xls'],
    officialFileNames = ['官网渠道.xls'],
    smsPasswords,
    officialPasswords,
    dryRun = false,
    onProgress,
  } = params

  onProgress?.({ phase: 'parse' })
  const preview = previewPostUseChannelImport(smsBuffers, officialBuffers, {
    importMonth,
    catalogProducts: getCatalogProducts(),
    smsPasswords,
    officialPasswords,
  })

  const importBatchId = `pur_${importMonth}_${randomId().slice(0, 8)}`
  const importedAt = new Date().toISOString()
  const records = buildPostUseRatingRecords(
    [...preview.merged.scored, ...preview.merged.options], {
    importMonth,
    importBatchId,
    importBatchName: `用后即评-${importMonth}`,
    importFileName: `${smsFileNames.join('+')}+${officialFileNames.join('+')}`,
    importedAt,
    },
  )

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
        r.sourceSubType === 'web_option' ||
        r.channel === 'sms' ||
        r.channel === 'console' ||
        r.channel === 'callback' || r.channel === 'option'),
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

  const callbackMatched = Number(followUpResult?.summary?.matched ?? followUpResult?.matched ?? followUpResult?.updatedRecords?.length ?? 0)
  const quality = buildPostUsePeriodQuality({
    importMonth,
    merged: preview.merged,
    catalogProducts: getCatalogProducts(),
    callbackLinkage: {
      matched: callbackMatched,
      unmatched: Math.max(0, callbackRawRows.length - callbackMatched),
    },
    importedAt,
    importBatchId,
  })
  await persistPostUsePeriodQuality(adapter, quality)

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
    quality,
  }
}
