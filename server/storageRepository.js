import {
  DEFAULT_TENANT_ID,
  LEGACY_INSIGHT_PERIOD_ID,
  SCHEMA_VERSION,
} from '../src/domain/constants.js'
import { createInsightPeriod, normalizeInsightPeriod, recordMatchesPeriod, resolveInsightPeriod } from '../src/domain/insightPeriod.js'
import {
  applyRecordWriteMetadata,
  getRecordRevision,
  RECORD_CONFLICT_CODE,
} from '../src/domain/recordRevision.js'
import {
  buildRecordsWhereClause,
  parseRecordPagination,
  recordIndexFields,
} from './recordIndex.js'
import { getDb } from './db.js'
import { META_KEY_STORAGE_INIT } from './businessDb.js'
import { bumpDataRevision } from './dataRevision.js'
import {
  analysisRunMatchesClearFilter,
  isClearAllImportedData,
  pendingTagCandidateMatchesClearFilter,
  recordMatchesClearFilter,
  snapshotMatchesClearFilter,
} from '../src/storage/clearImportedData.js'

/**
 * @param {import('../src/storage/adapter.js').RecordQuery} [query]
 * @param {import('../src/domain/records.js').InsightRecord[]} records
 * @param {import('../src/domain/insightPeriod.js').InsightPeriod | null} [period]
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

function parseJson(text) {
  return JSON.parse(text)
}

function stringifyJson(value) {
  return JSON.stringify(value)
}

const META_KEY_PERIODS = 'insight_periods'

export const storageRepository = {
  async init() {
    const initialized = this.getMeta(META_KEY_STORAGE_INIT)
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
      this.putMeta(META_KEY_PERIODS, [legacy])
      this.putMeta(META_KEY_STORAGE_INIT, true)
    }
  },

  listInsightPeriods() {
    const value = this.getMeta(META_KEY_PERIODS)
    return /** @type {import('../src/domain/insightPeriod.js').InsightPeriod[]} */ (value ?? [])
  },

  putInsightPeriod(period) {
    const list = this.listInsightPeriods()
    const idx = list.findIndex((p) => p.id === period.id)
    const next = [...list]
    if (idx >= 0) next[idx] = { ...period, updatedAt: new Date().toISOString() }
    else next.push(period)
    this.putMeta(META_KEY_PERIODS, next)
  },

  getInsightPeriod(id) {
    const fromList = this.listInsightPeriods().find((p) => p.id === id) ?? null
    return resolveInsightPeriod(id, fromList)
  },

  /**
   * @param {import('../src/storage/adapter.js').RecordQuery} [query]
   * @returns {{ records: import('../src/domain/records.js').InsightRecord[]; total: number; limit: number | null; offset: number }}
   */
  listRecords(query = {}) {
    const db = getDb()
    const period = query.insightPeriodId ? this.getInsightPeriod(query.insightPeriodId) : null
    const { limit, offset } = parseRecordPagination(query)
    const { where, params } = buildRecordsWhereClause(query, period)

    const total = db.prepare(`SELECT COUNT(*) AS n FROM records WHERE ${where}`).get(...params).n

    let sql = `SELECT payload FROM records WHERE ${where} ORDER BY import_month DESC, id ASC`
    const listParams = [...params]
    if (limit != null) {
      sql += ' LIMIT ? OFFSET ?'
      listParams.push(limit, offset)
    }

    const rows = db.prepare(sql).all(...listParams)
    let records = rows.map((r) => parseJson(r.payload))

    if (period && query.insightPeriodId) {
      records = filterRecords(records, query, period)
    } else if (query.importBatchId) {
      records = filterRecords(records, query, null)
    }

    return {
      records,
      total,
      limit: limit ?? total,
      offset: limit != null ? offset : 0,
    }
  },

  putRecord(record, options = {}) {
    const db = getDb()
    const existing = this.getRecord(record.id)
    const currentRevision = getRecordRevision(existing)

    if (
      options.expectedRevision != null &&
      options.expectedRevision !== currentRevision
    ) {
      const err = new Error('记录已被他人更新，请刷新后重试')
      err.code = RECORD_CONFLICT_CODE
      err.current = existing
      err.currentRevision = currentRevision
      throw err
    }

    const next = applyRecordWriteMetadata(record, {
      previousRevision: currentRevision,
      actor: options.actor ?? null,
    })
    const idx = recordIndexFields(next)
    db.prepare(
      `INSERT OR REPLACE INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      next.id,
      stringifyJson(next),
      idx.importMonth,
      idx.dataSourceType,
      idx.tenantId,
      idx.importBatchId,
    )
    bumpDataRevision()
    return { record: next, recordRevision: next.recordRevision }
  },

  putRecords(records) {
    const db = getDb()
    const getExisting = db.prepare('SELECT payload FROM records WHERE id = ?')
    const stmt = db.prepare(
      `INSERT OR REPLACE INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const tx = db.transaction((items) => {
      for (const record of items) {
        const row = getExisting.get(record.id)
        const existing = row ? parseJson(row.payload) : null
        const next = applyRecordWriteMetadata(record, {
          previousRevision: getRecordRevision(existing),
        })
        const idx = recordIndexFields(next)
        stmt.run(
          next.id,
          stringifyJson(next),
          idx.importMonth,
          idx.dataSourceType,
          idx.tenantId,
          idx.importBatchId,
        )
      }
    })
    tx(records)
    if (records.length) bumpDataRevision()
  },

  replaceAllRecords(records) {
    const db = getDb()
    const tx = db.transaction((items) => {
      db.prepare('DELETE FROM records').run()
      const stmt = db.prepare(
        `INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      for (const record of items) {
        const idx = recordIndexFields(record)
        stmt.run(
          record.id,
          stringifyJson(record),
          idx.importMonth,
          idx.dataSourceType,
          idx.tenantId,
          idx.importBatchId,
        )
      }
    })
    tx(records)
    bumpDataRevision()
  },

  /**
   * @param {import('../src/storage/clearImportedData.js').ClearImportedDataOptions} [options]
   * @returns {import('../src/storage/clearImportedData.js').ClearImportedDataResult}
   */
  clearImportedData(options = {}) {
    const db = getDb()
    /** @type {import('../src/storage/clearImportedData.js').ClearImportedDataResult} */
    const result = {
      recordsDeleted: 0,
      snapshotsDeleted: 0,
      runsDeleted: 0,
      artifactsDeleted: 0,
      pendingTagCandidatesDeleted: 0,
    }

    if (isClearAllImportedData(options)) {
      result.recordsDeleted = db.prepare('SELECT COUNT(*) AS n FROM records').get().n
      result.snapshotsDeleted = db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n
      result.runsDeleted = db.prepare('SELECT COUNT(*) AS n FROM analysis_runs').get().n
      result.artifactsDeleted = db.prepare('SELECT COUNT(*) AS n FROM artifacts').get().n
      result.pendingTagCandidatesDeleted = db
        .prepare("SELECT COUNT(*) AS n FROM tag_candidates WHERE status = 'pending'")
        .get().n
      db.exec(`
        DELETE FROM records;
        DELETE FROM snapshots;
        DELETE FROM analysis_runs;
        DELETE FROM insight_rebuild_jobs;
        DELETE FROM artifacts;
        DELETE FROM tag_candidates WHERE status = 'pending';
      `)
      bumpDataRevision()
      return result
    }

    const period = options.insightPeriodId
      ? this.getInsightPeriod(options.insightPeriodId)
      : null
    const { where, params } = buildRecordsWhereClause(
      {
        insightPeriodId: options.insightPeriodId,
        dataSourceType: options.dataSourceType,
      },
      period,
    )
    const rows = db.prepare(`SELECT id, payload FROM records WHERE ${where}`).all(...params)
    const recordIds = rows
      .map((row) => ({ id: row.id, record: parseJson(row.payload) }))
      .filter(({ record }) => recordMatchesClearFilter(record, options, period))
      .map(({ id }) => id)

    if (recordIds.length) {
      const chunkSize = 500
      for (let i = 0; i < recordIds.length; i += chunkSize) {
        const chunk = recordIds.slice(i, i + chunkSize)
        const placeholders = chunk.map(() => '?').join(',')
        db.prepare(`DELETE FROM records WHERE id IN (${placeholders})`).run(...chunk)
      }
      result.recordsDeleted = recordIds.length
    }

    const deletedRecordIds = new Set(recordIds)
    const snapshotRows = db.prepare('SELECT id FROM snapshots').all()
    for (const row of snapshotRows) {
      if (!snapshotMatchesClearFilter(row.id, options)) continue
      db.prepare('DELETE FROM snapshots WHERE id = ?').run(row.id)
      result.snapshotsDeleted += 1
    }

    const runRows = db.prepare('SELECT id, payload FROM analysis_runs').all()
    /** @type {string[]} */
    const runIdsToDelete = []
    for (const row of runRows) {
      const run = parseJson(row.payload)
      if (!analysisRunMatchesClearFilter(run, options)) continue
      runIdsToDelete.push(row.id)
    }
    for (const runId of runIdsToDelete) {
      result.artifactsDeleted += db
        .prepare('SELECT COUNT(*) AS n FROM artifacts WHERE run_id = ?')
        .get(runId).n
      db.prepare('DELETE FROM artifacts WHERE run_id = ?').run(runId)
      db.prepare('DELETE FROM analysis_runs WHERE id = ?').run(runId)
      result.runsDeleted += 1
    }

    const pending = this.listTagCandidates({ status: 'pending' })
    for (const candidate of pending) {
      if (!pendingTagCandidateMatchesClearFilter(candidate, options, deletedRecordIds)) continue
      this.deleteTagCandidate(candidate.id)
      result.pendingTagCandidatesDeleted += 1
    }

    if (
      result.recordsDeleted ||
      result.snapshotsDeleted ||
      result.runsDeleted ||
      result.pendingTagCandidatesDeleted
    ) {
      bumpDataRevision()
    }
    return result
  },

  getRecord(id) {
    const db = getDb()
    const row = db.prepare('SELECT payload FROM records WHERE id = ?').get(id)
    return row ? parseJson(row.payload) : null
  },

  deleteRecord(id) {
    getDb().prepare('DELETE FROM records WHERE id = ?').run(id)
    bumpDataRevision()
  },

  putAnalysisRun(run) {
    const db = getDb()
    db.prepare(
      `INSERT OR REPLACE INTO analysis_runs (id, idempotency_key, insight_period_id, payload)
       VALUES (?, ?, ?, ?)`,
    ).run(run.id, run.idempotencyKey ?? null, run.insightPeriodId, stringifyJson(run))
  },

  getAnalysisRun(id) {
    const row = getDb().prepare('SELECT payload FROM analysis_runs WHERE id = ?').get(id)
    return row ? parseJson(row.payload) : null
  },

  findRunByIdempotencyKey(idempotencyKey) {
    const row = getDb()
      .prepare('SELECT payload FROM analysis_runs WHERE idempotency_key = ?')
      .get(idempotencyKey)
    return row ? parseJson(row.payload) : null
  },

  listAnalysisRuns(insightPeriodId, dataSourceType) {
    const db = getDb()
    let runs = db
      .prepare('SELECT payload FROM analysis_runs WHERE insight_period_id = ?')
      .all(insightPeriodId)
      .map((r) => parseJson(r.payload))
    if (dataSourceType) {
      runs = runs.filter((r) => r.dataSourceType === dataSourceType)
    }
    return runs
  },

  putInsightRebuildJob(job) {
    const db = getDb()
    db.prepare(
      `INSERT OR REPLACE INTO insight_rebuild_jobs (id, insight_period_id, idempotency_key, status, payload)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(
      job.id,
      job.insightPeriodId,
      job.idempotencyKey ?? null,
      job.status,
      stringifyJson(job),
    )
  },

  getInsightRebuildJob(id) {
    const row = getDb().prepare('SELECT payload FROM insight_rebuild_jobs WHERE id = ?').get(id)
    return row ? parseJson(row.payload) : null
  },

  findActiveInsightRebuildJob(insightPeriodId) {
    const rows = getDb()
      .prepare(
        `SELECT payload FROM insight_rebuild_jobs
         WHERE insight_period_id = ?
         AND status IN ('queued', 'running')`,
      )
      .all(insightPeriodId)
    /** @type {import('../src/domain/insightRebuildJob.js').InsightRebuildJob | null} */
    let latest = null
    for (const row of rows) {
      const job = parseJson(row.payload)
      if (!job || (job.status !== 'queued' && job.status !== 'running')) continue
      if (!latest || String(job.createdAt || '') > String(latest.createdAt || '')) {
        latest = job
      }
    }
    return latest
  },

  listInsightRebuildJobs(insightPeriodId, limit = 10) {
    const rows = getDb()
      .prepare(
        `SELECT payload FROM insight_rebuild_jobs
         WHERE insight_period_id = ?
         ORDER BY json_extract(payload, '$.createdAt') DESC
         LIMIT ?`,
      )
      .all(insightPeriodId, limit)
    return rows.map((r) => parseJson(r.payload))
  },

  recoverOrphanedInsightRebuildJobs() {
    const db = getDb()
    const rows = db
      .prepare(`SELECT id, payload FROM insight_rebuild_jobs WHERE status IN ('queued', 'running')`)
      .all()
    const now = new Date().toISOString()
    for (const row of rows) {
      const job = parseJson(row.payload)
      if (!job) continue
      const recovered = {
        ...job,
        status: 'failed',
        errorSummary: '服务重启，任务已中断',
        finishedAt: now,
        progress: { ...job.progress, stage: null },
      }
      db.prepare(
        `UPDATE insight_rebuild_jobs SET status = ?, payload = ? WHERE id = ?`,
      ).run('failed', stringifyJson(recovered), row.id)
    }
    return rows.length
  },

  putArtifact(artifact, debug = false) {
    const db = getDb()
    db.prepare(
      'INSERT OR REPLACE INTO artifacts (id, run_id, debug, payload) VALUES (?, ?, ?, ?)',
    ).run(artifact.id, artifact.runId, debug ? 1 : 0, stringifyJson(artifact))
  },

  listArtifactsByRun(runId, debug = false) {
    const rows = getDb()
      .prepare('SELECT payload FROM artifacts WHERE run_id = ? AND debug = ?')
      .all(runId, debug ? 1 : 0)
    return rows.map((r) => parseJson(r.payload))
  },

  putSnapshot(snapshot) {
    const db = getDb()
    db.prepare(
      'INSERT OR REPLACE INTO snapshots (id, insight_period_id, payload) VALUES (?, ?, ?)',
    ).run(snapshot.id, snapshot.insightPeriodId, stringifyJson(snapshot))
    bumpDataRevision()
  },

  getSnapshot(id) {
    const row = getDb().prepare('SELECT payload FROM snapshots WHERE id = ?').get(id)
    return row ? parseJson(row.payload) : null
  },

  listSnapshotsByPeriod(insightPeriodId) {
    const rows = getDb()
      .prepare('SELECT payload FROM snapshots WHERE insight_period_id = ?')
      .all(insightPeriodId)
    return rows.map((r) => parseJson(r.payload))
  },

  getMeta(key) {
    const row = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key)
    return row ? parseJson(row.value) : null
  },

  putMeta(key, value) {
    getDb()
      .prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)')
      .run(key, stringifyJson(value))
  },

  deleteMeta(key) {
    getDb().prepare('DELETE FROM meta WHERE key = ?').run(key)
  },

  listTagCandidates(filters = {}) {
    const db = getDb()
    let sql = 'SELECT payload FROM tag_candidates'
    const params = []
    const clauses = []
    if (filters.status) {
      clauses.push('status = ?')
      params.push(filters.status)
    }
    if (filters.tagType) {
      clauses.push('tag_type = ?')
      params.push(filters.tagType)
    }
    if (clauses.length) sql += ` WHERE ${clauses.join(' AND ')}`
    const list = db.prepare(sql).all(...params).map((r) => parseJson(r.payload))
    return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  },

  putTagCandidate(candidate) {
    const db = getDb()
    db.prepare(
      'INSERT OR REPLACE INTO tag_candidates (id, status, tag_type, payload) VALUES (?, ?, ?, ?)',
    ).run(candidate.id, candidate.status, candidate.tagType, stringifyJson(candidate))
    bumpDataRevision()
  },

  deleteTagCandidate(id) {
    getDb().prepare('DELETE FROM tag_candidates WHERE id = ?').run(id)
    bumpDataRevision()
  },

  putTagCandidates(candidates) {
    const db = getDb()
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO tag_candidates (id, status, tag_type, payload) VALUES (?, ?, ?, ?)',
    )
    const tx = db.transaction((items) => {
      for (const c of items) stmt.run(c.id, c.status, c.tagType, stringifyJson(c))
    })
    tx(candidates)
    if (candidates.length) bumpDataRevision()
  },

  getStats() {
    const db = getDb()
    const records = db.prepare('SELECT COUNT(*) AS n FROM records').get().n
    const snapshots = db.prepare('SELECT COUNT(*) AS n FROM snapshots').get().n
    const tagCandidates = db.prepare('SELECT COUNT(*) AS n FROM tag_candidates').get().n
    return { records, snapshots, tagCandidates }
  },

  /**
   * 服务端为空时一次性导入本机全量数据（多人共用前的首次迁移）
   * @param {{
   *   records?: import('../src/domain/records.js').InsightRecord[]
   *   periods?: import('../src/domain/insightPeriod.js').InsightPeriod[]
   *   snapshots?: (import('../src/domain/snapshot.js').InsightSnapshot | import('../src/domain/snapshot.js').OverviewSnapshot)[]
   *   runs?: import('../src/domain/analysisRun.js').AnalysisRun[]
   *   artifacts?: { artifact: import('../src/domain/analysisRun.js').RecordArtifact | import('../src/domain/analysisRun.js').RunArtifact; debug?: boolean }[]
   *   tagCandidates?: import('../src/domain/tagCandidate.js').TagCandidate[]
   *   meta?: { key: string; value: unknown }[]
   * }} payload
   */
  bootstrapFromLocal(payload) {
    const stats = this.getStats()
    if (stats.records > 0) {
      throw new Error('服务端已有数据，跳过迁移')
    }

    if (payload.records?.length) this.replaceAllRecords(payload.records)
    if (payload.periods?.length) {
      for (const period of payload.periods) this.putInsightPeriod(period)
    }
    if (payload.snapshots?.length) {
      for (const snapshot of payload.snapshots) this.putSnapshot(snapshot)
    }
    if (payload.runs?.length) {
      for (const run of payload.runs) this.putAnalysisRun(run)
    }
    if (payload.artifacts?.length) {
      for (const { artifact, debug } of payload.artifacts) {
        this.putArtifact(artifact, Boolean(debug))
      }
    }
    if (payload.tagCandidates?.length) this.putTagCandidates(payload.tagCandidates)
    if (payload.meta?.length) {
      for (const { key, value } of payload.meta) {
        if (value != null) this.putMeta(key, value)
      }
    }

    bumpDataRevision()
    return {
      records: payload.records?.length || 0,
      snapshots: payload.snapshots?.length || 0,
      tagCandidates: payload.tagCandidates?.length || 0,
    }
  },
}
