/**
 * 反馈记录 SSOT：IndexedDB records store
 * localStorage 仅用于一次性迁移，不再作为主读写路径。
 */
import { DEFAULT_TENANT_ID, SCHEMA_VERSION } from '../domain/constants.js'
import {
  clearFeedbacks as clearLegacyFeedbacks,
  loadFeedbacks as loadLegacyFeedbacks,
  normalizeStoredFeedback,
} from '../lib/storage.js'
import { fetchAllRecordPages, fetchRecordPagesForPeriod } from '../lib/recordLoader.js'
import { normalizeRecordTaxonomyKeys } from '../lib/taxonomyKeyAliases.js'

export const META_KEY_LS_FEEDBACKS_MIGRATED = 'legacy_ls_feedbacks_migrated'

/**
 * @param {import('../domain/records.js').InsightRecord} record
 */
export function normalizeFeedbackRecord(record) {
  const base = normalizeStoredFeedback(record)
  const normalized = {
    ...base,
    schemaVersion: base.schemaVersion || SCHEMA_VERSION,
    tenantId: base.tenantId || DEFAULT_TENANT_ID,
    dataSourceType: base.dataSourceType || 'complaint_ticket',
    recordStatus: base.recordStatus || 'analyzed',
  }
  normalizeRecordTaxonomyKeys(normalized)
  return normalized
}

/**
 * @param {import('./adapter.js').StorageAdapter} adapter
 * @param {import('./adapter.js').RecordQuery} [query]
 */
export async function listAllFeedbacks(adapter, query = {}) {
  const { records } = await fetchAllRecordPages(adapter, query)
  return records.map((r) => normalizeFeedbackRecord(r))
}

/**
 * @param {import('./adapter.js').StorageAdapter} adapter
 */
export async function getTotalRecordCount(adapter) {
  await adapter.init()
  if (typeof adapter.getStorageStats === 'function') {
    const stats = await adapter.getStorageStats()
    return stats.records ?? 0
  }
  const page = await adapter.listRecords({ limit: 1, offset: 0 })
  return page.total ?? 0
}

/**
 * 若 IDB 为空且 localStorage 有历史数据，则迁移后清空 localStorage。
 * @param {import('./adapter.js').StorageAdapter} adapter
 */
export async function migrateLegacyFeedbacksIfNeeded(adapter) {
  await adapter.init()
  const probe = await adapter.listRecords({ limit: 1, offset: 0 })
  if ((probe.total ?? 0) > 0) return { migrated: 0, source: 'idb' }

  const flag = await adapter.getMeta(META_KEY_LS_FEEDBACKS_MIGRATED)
  if (flag) return { migrated: 0, source: 'none' }

  const legacy = loadLegacyFeedbacks()
  if (!legacy.length) {
    await adapter.putMeta(META_KEY_LS_FEEDBACKS_MIGRATED, {
      at: new Date().toISOString(),
      count: 0,
    })
    return { migrated: 0, source: 'none' }
  }

  const normalized = legacy.map((r) => normalizeFeedbackRecord(r))
  await adapter.replaceAllRecords(normalized)
  clearLegacyFeedbacks()
  await adapter.putMeta(META_KEY_LS_FEEDBACKS_MIGRATED, {
    at: new Date().toISOString(),
    count: normalized.length,
  })
  return { migrated: normalized.length, source: 'localStorage' }
}

/**
 * 分页拉取全部反馈（含首次 localStorage 迁移）
 * @param {import('./adapter.js').StorageAdapter} adapter
 * @param {import('./adapter.js').RecordQuery} [query]
 */
export async function loadFeedbacksFromAdapter(adapter, query = {}) {
  await migrateLegacyFeedbacksIfNeeded(adapter)
  return listAllFeedbacks(adapter, query)
}

/**
 * 按洞察周期分页拉取（用于首屏与切换周期）
 * @param {import('./adapter.js').StorageAdapter} adapter
 * @param {string} insightPeriodId
 */
export async function loadFeedbacksForPeriod(adapter, insightPeriodId) {
  await migrateLegacyFeedbacksIfNeeded(adapter)
  const { records } = await fetchRecordPagesForPeriod(adapter, insightPeriodId)
  return records.map((r) => normalizeFeedbackRecord(r))
}

/**
 * 共享 API 存储（服务端 SQLite）：禁止用浏览器内存快照做全量 replace。
 * @param {import('./adapter.js').StorageAdapter} adapter
 */
export function isApiStorageAdapter(adapter) {
  return typeof adapter?.getDataRevision === 'function'
}

/**
 * 全量替换（仅用于 JSON 恢复、本机 IDB 等明确意图场景）。
 * @param {import('./adapter.js').StorageAdapter} adapter
 * @param {import('../domain/records.js').InsightRecord[]} records
 */
export async function persistFeedbacks(adapter, records) {
  const normalized = records.map((r) => normalizeFeedbackRecord(r))
  if (isApiStorageAdapter(adapter)) {
    console.warn(
      '[persistFeedbacks] 跳过共享库全量替换；请使用 putRecords / putRecord 增量写入',
    )
    return
  }
  await adapter.replaceAllRecords(normalized)
}

/**
 * @param {import('./adapter.js').StorageAdapter} adapter
 * @param {import('../domain/records.js').InsightRecord[]} records
 * @param {{ onProgress?: (uploaded: number, total: number, batchIndex: number, batchCount: number) => void }} [options]
 */
export async function persistRecordUpdates(adapter, records, options = {}) {
  const normalized = records.map((r) => normalizeFeedbackRecord(r))
  if (!normalized.length) return
  await adapter.putRecords(normalized, options)
}

/**
 * @param {import('./adapter.js').StorageAdapter} adapter
 * @param {import('../domain/records.js').InsightRecord} record
 */
export async function persistRecordUpdate(adapter, record) {
  await adapter.putRecord(normalizeFeedbackRecord(record))
}

/**
 * @param {import('./adapter.js').StorageAdapter} adapter
 */
async function clearPendingTagCandidates(adapter) {
  const pending = await adapter.listTagCandidates({ status: 'pending' })
  await Promise.all(pending.map((c) => adapter.deleteTagCandidate(c.id)))
}

/**
 * 清空已导入数据：反馈记录、洞察快照、分析运行与产物，以及待复核标签候选（保留设置、标签库、已采纳/已拒绝候选等 meta）
 * @param {import('./adapter.js').StorageAdapter} adapter
 */
export async function clearAllImportedData(adapter) {
  await adapter.init()
  if (typeof adapter.clearImportedData === 'function') {
    await adapter.clearImportedData()
  } else {
    await adapter.replaceAllRecords([])
    await clearPendingTagCandidates(adapter)
  }
  clearLegacyFeedbacks()
  await adapter.putMeta(META_KEY_LS_FEEDBACKS_MIGRATED, {
    at: new Date().toISOString(),
    count: 0,
  })
}

/** @param {import('./adapter.js').StorageAdapter} adapter */
export async function clearAllFeedbacks(adapter) {
  return clearAllImportedData(adapter)
}
