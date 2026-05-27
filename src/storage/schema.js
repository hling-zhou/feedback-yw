import { IDB_NAME, IDB_SCHEMA_VERSION } from '../domain/constants.js'

export { IDB_NAME, IDB_SCHEMA_VERSION }

/** @type {const} */
export const STORES = {
  records: 'records',
  analysis_runs: 'analysis_runs',
  artifacts: 'artifacts',
  artifacts_debug: 'artifacts_debug',
  snapshots: 'snapshots',
  meta: 'meta',
  tag_candidates: 'tag_candidates',
}

/**
 * @param {IDBDatabase} db
 */
export function upgradeSchema(db) {
  if (!db.objectStoreNames.contains(STORES.records)) {
    const records = db.createObjectStore(STORES.records, { keyPath: 'id' })
    records.createIndex('tenantId', 'tenantId', { unique: false })
    records.createIndex('insightPeriodId', 'insightPeriodId', { unique: false })
    records.createIndex('dataSourceType', 'dataSourceType', { unique: false })
    records.createIndex('importBatchId', 'importBatchId', { unique: false })
    records.createIndex('by_period_source', ['insightPeriodId', 'dataSourceType'], {
      unique: false,
    })
  }

  if (!db.objectStoreNames.contains(STORES.analysis_runs)) {
    const runs = db.createObjectStore(STORES.analysis_runs, { keyPath: 'id' })
    runs.createIndex('idempotencyKey', 'idempotencyKey', { unique: false })
    runs.createIndex('insightPeriodId', 'insightPeriodId', { unique: false })
    runs.createIndex('by_period_source', ['insightPeriodId', 'dataSourceType'], {
      unique: false,
    })
  }

  if (!db.objectStoreNames.contains(STORES.artifacts)) {
    const artifacts = db.createObjectStore(STORES.artifacts, { keyPath: 'id' })
    artifacts.createIndex('runId', 'runId', { unique: false })
  }

  if (!db.objectStoreNames.contains(STORES.artifacts_debug)) {
    const debug = db.createObjectStore(STORES.artifacts_debug, { keyPath: 'id' })
    debug.createIndex('runId', 'runId', { unique: false })
  }

  if (!db.objectStoreNames.contains(STORES.snapshots)) {
    db.createObjectStore(STORES.snapshots, { keyPath: 'id' })
  }

  if (!db.objectStoreNames.contains(STORES.meta)) {
    db.createObjectStore(STORES.meta, { keyPath: 'key' })
  }

  if (!db.objectStoreNames.contains(STORES.tag_candidates)) {
    const tc = db.createObjectStore(STORES.tag_candidates, { keyPath: 'id' })
    tc.createIndex('status', 'status', { unique: false })
    tc.createIndex('tagType', 'tagType', { unique: false })
  }
}
