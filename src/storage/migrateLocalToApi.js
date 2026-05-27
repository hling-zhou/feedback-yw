import { STORES } from './schema.js'
import { idbGetAll, openDatabase } from './idb.js'
import { fetchAllRecordPages } from '../lib/recordLoader.js'
import { getLocalIdbAdapter } from './localIdbAdapter.js'
import { apiFetch } from '../lib/apiClient.js'

export const META_KEY_LOCAL_MIGRATED = 'local_migrated_to_server_v1'

/** @type {readonly string[]} */
const META_KEYS_TO_MIGRATE = [
  'insight_periods',
  'storage_v2_initialized',
  'current_insight_period_id',
  'insight_period_selection',
  'legacy_ls_feedbacks_migrated',
  'taxonomy_managed',
  'taxonomy_overrides',
  'tag_library_version',
  'product_catalog_managed_v1',
  'product_order_volumes_v1',
]

/**
 * 首次登录且服务端为空时，将本机 IndexedDB 数据迁移到共享库。
 * @param {import('./adapter.js').StorageAdapter} apiAdapter
 */
export async function migrateLocalToApiIfNeeded(apiAdapter) {
  await apiAdapter.init()

  const migratedFlag = await apiAdapter.getMeta(META_KEY_LOCAL_MIGRATED)
  if (migratedFlag?.completed) {
    return { migrated: false, reason: 'already_migrated' }
  }

  const stats = await apiFetch('/api/storage/stats')
  if (stats.records > 0) {
    await apiAdapter.putMeta(META_KEY_LOCAL_MIGRATED, {
      completed: true,
      at: new Date().toISOString(),
      skipped: true,
      reason: 'server_not_empty',
    })
    return { migrated: false, reason: 'server_not_empty' }
  }

  const local = getLocalIdbAdapter()
  await local.init()

  const localProbe = await local.listRecords({ limit: 1, offset: 0 })
  if (!(localProbe.total ?? 0)) {
    await apiAdapter.putMeta(META_KEY_LOCAL_MIGRATED, {
      completed: true,
      at: new Date().toISOString(),
      skipped: true,
      reason: 'local_empty',
    })
    return { migrated: false, reason: 'local_empty' }
  }

  const { records: localRecords } = await fetchAllRecordPages(local)

  await openDatabase()

  const snapshots = /** @type {import('../domain/snapshot.js').InsightSnapshot[]} */ (
    await idbGetAll(STORES.snapshots)
  )
  const runs = await idbGetAll(STORES.analysis_runs)
  /** @type {{ artifact: import('../domain/analysisRun.js').RecordArtifact; debug?: boolean }[]} */
  const artifacts = []
  for (const debug of [false, true]) {
    const store = debug ? STORES.artifacts_debug : STORES.artifacts
    const rows = await idbGetAll(store)
    for (const artifact of rows) artifacts.push({ artifact, debug })
  }

  const tagCandidates = await local.listTagCandidates()
  /** @type {{ key: string; value: unknown }[]} */
  const meta = []
  for (const key of META_KEYS_TO_MIGRATE) {
    const value = await local.getMeta(key)
    if (value != null) meta.push({ key, value })
  }

  const result = await apiFetch('/api/storage/bootstrap-from-local', {
    method: 'POST',
    body: JSON.stringify({
      records: localRecords,
      periods: await local.listInsightPeriods(),
      snapshots,
      runs,
      artifacts,
      tagCandidates,
      meta,
    }),
  })

  await apiAdapter.putMeta(META_KEY_LOCAL_MIGRATED, {
    completed: true,
    at: new Date().toISOString(),
    records: result.records,
    snapshots: result.snapshots,
    tagCandidates: result.tagCandidates,
  })

  return {
    migrated: true,
    records: result.records,
    snapshots: result.snapshots,
    tagCandidates: result.tagCandidates,
  }
}
