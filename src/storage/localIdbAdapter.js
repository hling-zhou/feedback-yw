import {
  DEFAULT_TENANT_ID,
  LEGACY_INSIGHT_PERIOD_ID,
  SCHEMA_VERSION,
} from '../domain/constants.js'
import { createInsightPeriod, normalizeInsightPeriod, recordMatchesPeriod } from '../domain/insightPeriod.js'
import {
  idbClearStore,
  idbDelete,
  idbGet,
  idbGetAll,
  idbGetAllByIndex,
  idbPut,
  openDatabase,
} from './idb.js'
import { STORES } from './schema.js'

/** @typedef {import('./adapter.js').StorageAdapter} StorageAdapter */
/** @typedef {import('./adapter.js').RecordQuery} RecordQuery */
/** @typedef {import('../domain/records.js').InsightRecord} InsightRecord */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../domain/analysisRun.js').AnalysisRun} AnalysisRun */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */
/** @typedef {import('../domain/snapshot.js').OverviewSnapshot} OverviewSnapshot */

const META_KEY_PERIODS = 'insight_periods'
const META_KEY_STORAGE_INIT = 'storage_v2_initialized'

/** @type {StorageAdapter | null} */
let singleton = null

/**
 * @param {RecordQuery} [query]
 * @param {InsightRecord[]} records
 */
/**
 * @param {InsightRecord[]} records
 * @param {RecordQuery} [query]
 * @param {InsightPeriod | null} [period] 若提供则按数据时间匹配
 */
function filterRecords(records, query = {}, period = null) {
  const normalized = period ? normalizeInsightPeriod(period) : null
  return records.filter((r) => {
    if (query.tenantId && r.tenantId !== query.tenantId) return false
    if (query.dataSourceType && r.dataSourceType !== query.dataSourceType) return false
    if (query.importBatchId && r.importBatchId !== query.importBatchId) return false
    if (query.insightPeriodId) {
      if (normalized) {
        if (!recordMatchesPeriod(r, normalized)) return false
      } else if (r.insightPeriodId && r.insightPeriodId !== query.insightPeriodId) {
        return false
      } else if (!r.insightPeriodId && query.insightPeriodId !== LEGACY_INSIGHT_PERIOD_ID) {
        return false
      }
    }
    return true
  })
}

/** @returns {StorageAdapter} */
export function getLocalIdbAdapter() {
  if (!singleton) {
    singleton = createLocalIdbAdapter()
  }
  return singleton
}

/** @returns {StorageAdapter} */
export function createLocalIdbAdapter() {
  return {
    async init() {
      await openDatabase()
      const initialized = await idbGet(STORES.meta, META_KEY_STORAGE_INIT)
      if (!initialized) {
        const legacy = createInsightPeriod(
          {
            id: LEGACY_INSIGHT_PERIOD_ID,
            label: '历史数据（默认周期）',
            startDate: '2000-01-01',
            endDate: '2099-12-31',
            status: 'active',
          },
          SCHEMA_VERSION,
          DEFAULT_TENANT_ID,
        )
        await idbPut(STORES.meta, { key: META_KEY_PERIODS, value: [legacy] })
        await idbPut(STORES.meta, { key: META_KEY_STORAGE_INIT, value: true })
      }
    },

    async listInsightPeriods() {
      const row = await idbGet(STORES.meta, META_KEY_PERIODS)
      return /** @type {InsightPeriod[]} */ (row?.value ?? [])
    },

    async putInsightPeriod(period) {
      const list = await this.listInsightPeriods()
      const idx = list.findIndex((p) => p.id === period.id)
      const next = [...list]
      if (idx >= 0) next[idx] = { ...period, updatedAt: new Date().toISOString() }
      else next.push(period)
      await idbPut(STORES.meta, { key: META_KEY_PERIODS, value: next })
    },

    async getInsightPeriod(id) {
      const list = await this.listInsightPeriods()
      return list.find((p) => p.id === id) ?? null
    },

    async listRecords(query = {}) {
      const records = /** @type {InsightRecord[]} */ (await idbGetAll(STORES.records))
      const period = query?.insightPeriodId
        ? await this.getInsightPeriod(query.insightPeriodId)
        : null
      const filtered = filterRecords(records, query, period)
      const total = filtered.length
      const limit = query.limit
      const offset = query.offset ?? 0
      if (limit == null) {
        return { records: filtered, total, limit: total, offset: 0 }
      }
      return {
        records: filtered.slice(offset, offset + limit),
        total,
        limit,
        offset,
      }
    },

    async getStorageStats() {
      const records = /** @type {unknown[]} */ (await idbGetAll(STORES.records))
      const snapshots = /** @type {unknown[]} */ (await idbGetAll(STORES.snapshots))
      const tagCandidates = /** @type {unknown[]} */ (await idbGetAll(STORES.tag_candidates))
      return {
        records: records.length,
        snapshots: snapshots.length,
        tagCandidates: tagCandidates.length,
      }
    },

    async putRecord(record) {
      await idbPut(STORES.records, record)
    },

    async putRecords(records) {
      for (const record of records) {
        await idbPut(STORES.records, record)
      }
    },

    async replaceAllRecords(records) {
      await idbClearStore(STORES.records)
      for (const record of records) {
        await idbPut(STORES.records, record)
      }
    },

    async clearImportedData() {
      await idbClearStore(STORES.records)
      await idbClearStore(STORES.snapshots)
      await idbClearStore(STORES.analysis_runs)
      await idbClearStore(STORES.artifacts)
      await idbClearStore(STORES.artifacts_debug)
      const pending = /** @type {{ id: string }[]} */ (
        await idbGetAllByIndex(STORES.tag_candidates, 'status', 'pending')
      )
      await Promise.all(pending.map((c) => idbDelete(STORES.tag_candidates, c.id)))
    },

    async getRecord(id) {
      return /** @type {InsightRecord | null} */ (await idbGet(STORES.records, id))
    },

    async deleteRecord(id) {
      await idbDelete(STORES.records, id)
    },

    async putAnalysisRun(run) {
      await idbPut(STORES.analysis_runs, run)
    },

    async getAnalysisRun(id) {
      return /** @type {AnalysisRun | null} */ (await idbGet(STORES.analysis_runs, id))
    },

    async findRunByIdempotencyKey(idempotencyKey) {
      const runs = /** @type {AnalysisRun[]} */ (
        await idbGetAllByIndex(STORES.analysis_runs, 'idempotencyKey', idempotencyKey)
      )
      return runs[0] ?? null
    },

    async listAnalysisRuns(insightPeriodId, dataSourceType) {
      let runs = /** @type {AnalysisRun[]} */ (await idbGetAll(STORES.analysis_runs))
      if (dataSourceType) {
        try {
          const indexed = await idbGetAllByIndex(
            STORES.analysis_runs,
            'by_period_source',
            [insightPeriodId, dataSourceType],
          )
          if (indexed.length) runs = /** @type {AnalysisRun[]} */ (indexed)
        } catch {
          /* fallback */
        }
      }
      return runs.filter((r) => r.insightPeriodId === insightPeriodId)
    },

    async putArtifact(artifact, debug = false) {
      const store = debug ? STORES.artifacts_debug : STORES.artifacts
      await idbPut(store, artifact)
    },

    async listArtifactsByRun(runId, debug = false) {
      const store = debug ? STORES.artifacts_debug : STORES.artifacts
      return /** @type {import('../domain/analysisRun.js').RecordArtifact[]} */ (
        await idbGetAllByIndex(store, 'runId', runId)
      )
    },

    async putSnapshot(snapshot) {
      await idbPut(STORES.snapshots, snapshot)
    },

    async getSnapshot(id) {
      return /** @type {InsightSnapshot | OverviewSnapshot | null} */ (
        await idbGet(STORES.snapshots, id)
      )
    },

    async listSnapshotsByPeriod(insightPeriodId) {
      const all = /** @type {(InsightSnapshot | OverviewSnapshot)[]} */ (
        await idbGetAll(STORES.snapshots)
      )
      return all.filter((s) => s.insightPeriodId === insightPeriodId)
    },

    async getMeta(key) {
      const row = await idbGet(STORES.meta, key)
      return row?.value ?? null
    },

    async putMeta(key, value) {
      await idbPut(STORES.meta, { key, value })
    },

    async listTagCandidates(filters = {}) {
      let list = /** @type {import('../domain/tagCandidate.js').TagCandidate[]} */ (
        await idbGetAll(STORES.tag_candidates)
      )
      if (filters.status) list = list.filter((c) => c.status === filters.status)
      if (filters.tagType) list = list.filter((c) => c.tagType === filters.tagType)
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    },

    async putTagCandidate(candidate) {
      await idbPut(STORES.tag_candidates, candidate)
    },

    async deleteTagCandidate(id) {
      await idbDelete(STORES.tag_candidates, id)
    },

    async putTagCandidates(candidates) {
      for (const c of candidates) {
        await idbPut(STORES.tag_candidates, c)
      }
    },
  }
}
