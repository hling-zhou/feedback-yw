import { apiFetch } from '../lib/apiClient.js'
import { chunkRecordsForUpload } from '../lib/recordUploadChunks.js'

/**
 * @typedef {Object} PutRecordsOptions
 * @property {(uploaded: number, total: number, batchIndex: number, batchCount: number) => void} [onProgress]
 */

/** @typedef {import('./adapter.js').StorageAdapter} StorageAdapter */
/** @typedef {import('./adapter.js').RecordQuery} RecordQuery */

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
async function storageFetch(path, init = {}) {
  return apiFetch(`/api/storage${path}`, init)
}

/** @returns {StorageAdapter} */
export function createApiStorageAdapter() {
  return {
    async init() {
      await storageFetch('/init', { method: 'POST' })
    },

    async getDataRevision() {
      return storageFetch('/revision')
    },

    async listInsightPeriods() {
      const data = await storageFetch('/periods')
      return data.periods || []
    },

    async putInsightPeriod(period) {
      await storageFetch('/periods', {
        method: 'PUT',
        body: JSON.stringify({ period }),
      })
    },

    async getInsightPeriod(id) {
      try {
        const data = await storageFetch(`/periods/${encodeURIComponent(id)}`)
        return data.period ?? null
      } catch (err) {
        if (err.status === 404) return null
        throw err
      }
    },

    async listRecords(query = {}) {
      const params = new URLSearchParams()
      if (query.tenantId) params.set('tenantId', query.tenantId)
      if (query.insightPeriodId) params.set('insightPeriodId', query.insightPeriodId)
      if (query.dataSourceType) params.set('dataSourceType', query.dataSourceType)
      if (query.importBatchId) params.set('importBatchId', query.importBatchId)
      if (query.limit != null) params.set('limit', String(query.limit))
      if (query.offset != null) params.set('offset', String(query.offset))
      const qs = params.toString()
      const data = await storageFetch(`/records${qs ? `?${qs}` : ''}`)
      return {
        records: data.records || [],
        total: data.total ?? (data.records?.length ?? 0),
        limit: data.limit ?? query.limit ?? data.records?.length ?? 0,
        offset: data.offset ?? query.offset ?? 0,
      }
    },

    async getStorageStats() {
      return storageFetch('/stats')
    },

    async putRecord(record) {
      await storageFetch(`/records/${encodeURIComponent(record.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ record }),
      })
    },

    /**
     * @param {import('../domain/records.js').InsightRecord[]} records
     * @param {PutRecordsOptions} [options]
     */
    async putRecords(records, options = {}) {
      if (!records.length) return
      const batches = chunkRecordsForUpload(records)
      const batchCount = batches.length
      let uploaded = 0
      for (let i = 0; i < batches.length; i++) {
        const batch = batches[i]
        await storageFetch('/records/batch', {
          method: 'POST',
          body: JSON.stringify({ records: batch }),
        })
        uploaded += batch.length
        options.onProgress?.(uploaded, records.length, i + 1, batchCount)
      }
    },

    async replaceAllRecords(records) {
      await storageFetch('/records', {
        method: 'PUT',
        body: JSON.stringify({ records }),
      })
    },

    async clearImportedData(options = {}) {
      const params = new URLSearchParams()
      if (options.all) {
        params.set('scope', 'all')
      } else {
        if (options.insightPeriodId) params.set('insightPeriodId', options.insightPeriodId)
        if (options.dataSourceType) params.set('dataSourceType', options.dataSourceType)
      }
      const qs = params.toString()
      return storageFetch(`/imported-data${qs ? `?${qs}` : ''}`, { method: 'DELETE' })
    },

    async getRecord(id) {
      try {
        const data = await storageFetch(`/records/${encodeURIComponent(id)}`)
        return data.record ?? null
      } catch (err) {
        if (err.status === 404) return null
        throw err
      }
    },

    async deleteRecord(id) {
      await storageFetch(`/records/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    async putAnalysisRun(run) {
      await storageFetch('/runs', {
        method: 'PUT',
        body: JSON.stringify({ run }),
      })
    },

    async getAnalysisRun(id) {
      try {
        const data = await storageFetch(`/runs/${encodeURIComponent(id)}`)
        return data.run ?? null
      } catch (err) {
        if (err.status === 404) return null
        throw err
      }
    },

    async findRunByIdempotencyKey(idempotencyKey) {
      const params = new URLSearchParams({ key: idempotencyKey })
      const data = await storageFetch(`/runs/by-idempotency?${params}`)
      return data.run ?? null
    },

    async listAnalysisRuns(insightPeriodId, dataSourceType) {
      const params = new URLSearchParams({ insightPeriodId })
      if (dataSourceType) params.set('dataSourceType', dataSourceType)
      const data = await storageFetch(`/runs?${params}`)
      return data.runs || []
    },

    async putArtifact(artifact, debug = false) {
      await storageFetch('/artifacts', {
        method: 'PUT',
        body: JSON.stringify({ artifact, debug }),
      })
    },

    async listArtifactsByRun(runId, debug = false) {
      const params = new URLSearchParams({ runId, debug: debug ? '1' : '0' })
      const data = await storageFetch(`/artifacts?${params}`)
      return data.artifacts || []
    },

    async putSnapshot(snapshot) {
      await storageFetch('/snapshots', {
        method: 'PUT',
        body: JSON.stringify({ snapshot }),
      })
    },

    async getSnapshot(id) {
      try {
        const data = await storageFetch(`/snapshots/${encodeURIComponent(id)}`)
        return data.snapshot ?? null
      } catch (err) {
        if (err.status === 404) return null
        throw err
      }
    },

    async listSnapshotsByPeriod(insightPeriodId) {
      const params = new URLSearchParams({ insightPeriodId })
      const data = await storageFetch(`/snapshots?${params}`)
      return data.snapshots || []
    },

    async getMeta(key) {
      const data = await storageFetch(`/meta/${encodeURIComponent(key)}`)
      return data.value ?? null
    },

    async putMeta(key, value) {
      await storageFetch(`/meta/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value }),
      })
    },

    async listTagCandidates(filters = {}) {
      const params = new URLSearchParams()
      if (filters.status) params.set('status', filters.status)
      if (filters.tagType) params.set('tagType', filters.tagType)
      const qs = params.toString()
      const data = await storageFetch(`/tag-candidates${qs ? `?${qs}` : ''}`)
      return data.candidates || []
    },

    async putTagCandidate(candidate) {
      await storageFetch('/tag-candidates', {
        method: 'PUT',
        body: JSON.stringify({ candidate }),
      })
    },

    async deleteTagCandidate(id) {
      await storageFetch(`/tag-candidates/${encodeURIComponent(id)}`, { method: 'DELETE' })
    },

    async putTagCandidates(candidates) {
      await storageFetch('/tag-candidates', {
        method: 'PUT',
        body: JSON.stringify({ candidates }),
      })
    },
  }
}

/** @type {StorageAdapter | null} */
let singleton = null

/** @returns {StorageAdapter} */
export function getApiStorageAdapter() {
  if (!singleton) singleton = createApiStorageAdapter()
  return singleton
}
