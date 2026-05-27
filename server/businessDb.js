import { getDb } from './db.js'
import { recordIndexFields } from './recordIndex.js'
import { migrateBuiltinJourneysInSnapshot } from '../src/lib/tagLibrary/migrateBuiltinJourneys.js'
import { migrateProductCatalogKeys } from '../src/lib/migrateProductCatalogKeys.js'
import {
  migrateSharedTagsInSnapshot,
  migrateSharedTagsOnRecord,
} from '../src/lib/tagLibrary/migrateSharedTags.js'

const META_KEY_STORAGE_INIT = 'storage_v2_initialized'
const META_KEY_DC_PRODUCT_KEY_MIGRATION = 'migrate_ecc_to_dc_product_key_v1'
const META_KEY_SHARED_BANDWIDTH_TO_EIP = 'migrate_shared_bandwidth_to_eip_spec_v1'
const META_KEY_SLB_BUILTIN_JOURNEYS = 'migrate_slb_builtin_journeys_v1'
const META_KEY_BUILTIN_JOURNEYS_V2 = 'migrate_builtin_journeys_v2'
const META_KEY_PRODUCT_CATALOG_CANONICAL = 'migrate_product_catalog_canonical_keys_v1'
const META_KEY_SHARED_TAGS_V2 = 'migrate_shared_tags_v2'

const LEGACY_DC_PRODUCT_KEYS = new Set(['ecc', 'yunzx', 'yunzhuanxian'])
const SHARED_BANDWIDTH_LEGACY_KEY = '共享带宽'
const SHARED_BANDWIDTH_SPEC_NAME = '弹性公网IP-共享带宽'

function migrateLegacyDcProductKeys(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY_DC_PRODUCT_KEY_MIGRATION)
  if (done) return

  const rows = db.prepare('SELECT id, payload FROM records').all()
  if (!rows.length) {
    db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
      META_KEY_DC_PRODUCT_KEY_MIGRATION,
      JSON.stringify({ migratedRecords: 0, at: new Date().toISOString() }),
    )
    return
  }

  const update = db.prepare('UPDATE records SET payload = ? WHERE id = ?')
  let migratedRecords = 0
  const tx = db.transaction((items) => {
    for (const row of items) {
      const record = JSON.parse(row.payload)
      const pk = record.productKey?.trim()
      const tk = record.taxonomyKey?.trim()
      if (
        (pk && LEGACY_DC_PRODUCT_KEYS.has(pk)) ||
        (tk && LEGACY_DC_PRODUCT_KEYS.has(tk))
      ) {
        if (pk && LEGACY_DC_PRODUCT_KEYS.has(pk)) record.productKey = 'dc'
        if (tk && LEGACY_DC_PRODUCT_KEYS.has(tk)) record.taxonomyKey = 'dc'
        update.run(JSON.stringify(record), row.id)
        migratedRecords += 1
      }
    }
  })
  tx(rows)

  const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('taxonomy_managed')
  if (metaRow?.value) {
    try {
      const snapshot = JSON.parse(metaRow.value)
      if (snapshot?.products) {
        let metaChanged = false
        for (const legacyKey of LEGACY_DC_PRODUCT_KEYS) {
          if (snapshot.products[legacyKey]) {
            if (!snapshot.products.dc) {
              snapshot.products.dc = { ...snapshot.products[legacyKey], key: 'dc' }
            }
            delete snapshot.products[legacyKey]
            metaChanged = true
          }
        }
        const dc = snapshot.products.dc
        if (dc && !dc.name) {
          dc.name = '云专线'
          metaChanged = true
        }
        if (metaChanged) {
          snapshot.updatedAt = new Date().toISOString()
          db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
            'taxonomy_managed',
            JSON.stringify(snapshot),
          )
        }
      }
    } catch {
      /* ignore malformed taxonomy_managed */
    }
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    META_KEY_DC_PRODUCT_KEY_MIGRATION,
    JSON.stringify({ migratedRecords, at: new Date().toISOString() }),
  )
}

function migrateSharedBandwidthRecordPayload(record) {
  let changed = false
  const pk = record.productKey?.trim()
  const tk = record.taxonomyKey?.trim()
  const product = record.product?.trim()
  const spec = record.productSpec?.trim()

  if (pk === SHARED_BANDWIDTH_LEGACY_KEY || tk === SHARED_BANDWIDTH_LEGACY_KEY) {
    record.productKey = 'eip'
    record.taxonomyKey = 'eip'
    changed = true
  }
  if (product === SHARED_BANDWIDTH_LEGACY_KEY) {
    record.product = '弹性公网IP'
    changed = true
  }
  if (spec === SHARED_BANDWIDTH_LEGACY_KEY || (!spec && product === SHARED_BANDWIDTH_LEGACY_KEY)) {
    record.productSpec = SHARED_BANDWIDTH_SPEC_NAME
    changed = true
  }
  return changed
}

function migrateSharedBandwidthCatalogProducts(products) {
  if (!Array.isArray(products)) return { products, changed: false }
  const list = structuredClone(products)
  const legacyIdx = list.findIndex((p) => p?.key === SHARED_BANDWIDTH_LEGACY_KEY)
  const eipIdx = list.findIndex((p) => p?.key === 'eip')
  if (eipIdx < 0) return { products: list, changed: false }

  let changed = false
  const eip = list[eipIdx]
  const spec = {
    name: SHARED_BANDWIDTH_SPEC_NAME,
    match: [
      '共享带宽',
      '弹性公网IP-共享带宽',
      '弹性公网 IP-共享带宽',
      '弹性公网ip-共享带宽',
      '弹性公网IP共享带宽',
    ],
  }
  const hasSpec = (eip.specs || []).some(
    (s) => s?.name === SHARED_BANDWIDTH_SPEC_NAME || s?.name === SHARED_BANDWIDTH_LEGACY_KEY,
  )
  if (!hasSpec) {
    eip.specs = [...(eip.specs || []), spec]
    changed = true
  }
  if (legacyIdx >= 0 && legacyIdx !== eipIdx) {
    list.splice(legacyIdx, 1)
    changed = true
  }
  if (changed) list[eipIdx] = eip
  return { products: list, changed }
}

function migrateSharedBandwidthToEipSpec(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY_SHARED_BANDWIDTH_TO_EIP)
  if (done) return

  const rows = db.prepare('SELECT id, payload FROM records').all()
  const update = db.prepare('UPDATE records SET payload = ? WHERE id = ?')
  let migratedRecords = 0
  const tx = db.transaction((items) => {
    for (const row of items) {
      const record = JSON.parse(row.payload)
      if (migrateSharedBandwidthRecordPayload(record)) {
        update.run(JSON.stringify(record), row.id)
        migratedRecords += 1
      }
    }
  })
  tx(rows)

  for (const metaKey of ['taxonomy_managed', 'product_catalog_managed_v1']) {
    const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get(metaKey)
    if (!metaRow?.value) continue
    try {
      const snapshot = JSON.parse(metaRow.value)
      let metaChanged = false
      if (metaKey === 'taxonomy_managed' && snapshot?.products?.[SHARED_BANDWIDTH_LEGACY_KEY]) {
        delete snapshot.products[SHARED_BANDWIDTH_LEGACY_KEY]
        metaChanged = true
      }
      if (metaKey === 'product_catalog_managed_v1' && snapshot?.products) {
        const { products, changed } = migrateSharedBandwidthCatalogProducts(snapshot.products)
        if (changed) {
          snapshot.products = products
          metaChanged = true
        }
      }
      if (metaChanged) {
        snapshot.updatedAt = new Date().toISOString()
        db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
          metaKey,
          JSON.stringify(snapshot),
        )
      }
    } catch {
      /* ignore malformed meta */
    }
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    META_KEY_SHARED_BANDWIDTH_TO_EIP,
    JSON.stringify({ migratedRecords, at: new Date().toISOString() }),
  )
}

function migrateSlbBuiltinJourneysInMeta(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY_SLB_BUILTIN_JOURNEYS)
  if (done) return

  const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('taxonomy_managed')
  if (metaRow?.value) {
    try {
      const snapshot = JSON.parse(metaRow.value)
      if (migrateBuiltinJourneysInSnapshot(snapshot)) {
        snapshot.updatedAt = new Date().toISOString()
        db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
          'taxonomy_managed',
          JSON.stringify(snapshot),
        )
      }
    } catch {
      /* ignore malformed taxonomy_managed */
    }
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    META_KEY_SLB_BUILTIN_JOURNEYS,
    JSON.stringify({ at: new Date().toISOString() }),
  )
}

function migrateBuiltinJourneysV2InMeta(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY_BUILTIN_JOURNEYS_V2)
  if (done) return

  const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('taxonomy_managed')
  if (metaRow?.value) {
    try {
      const snapshot = JSON.parse(metaRow.value)
      if (migrateBuiltinJourneysInSnapshot(snapshot)) {
        snapshot.updatedAt = new Date().toISOString()
        db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
          'taxonomy_managed',
          JSON.stringify(snapshot),
        )
      }
    } catch {
      /* ignore malformed taxonomy_managed */
    }
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    META_KEY_BUILTIN_JOURNEYS_V2,
    JSON.stringify({ at: new Date().toISOString() }),
  )
}

function migrateProductCatalogCanonicalKeys(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY_PRODUCT_CATALOG_CANONICAL)
  if (done) return

  const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('product_catalog_managed_v1')
  if (metaRow?.value) {
    try {
      const snapshot = JSON.parse(metaRow.value)
      if (snapshot?.products?.length) {
        const { products, changed } = migrateProductCatalogKeys(snapshot.products)
        if (changed) {
          snapshot.products = products
          snapshot.updatedAt = new Date().toISOString()
          db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
            'product_catalog_managed_v1',
            JSON.stringify(snapshot),
          )
        }
      }
    } catch {
      /* ignore malformed product_catalog_managed_v1 */
    }
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    META_KEY_PRODUCT_CATALOG_CANONICAL,
    JSON.stringify({ at: new Date().toISOString() }),
  )
}

function migrateSharedTagsV2(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY_SHARED_TAGS_V2)
  if (done) return

  const rows = db.prepare('SELECT id, payload FROM records').all()
  const update = db.prepare('UPDATE records SET payload = ? WHERE id = ?')
  let migratedRecords = 0
  const tx = db.transaction((items) => {
    for (const row of items) {
      const record = JSON.parse(row.payload)
      if (migrateSharedTagsOnRecord(record)) {
        update.run(JSON.stringify(record), row.id)
        migratedRecords += 1
      }
    }
  })
  tx(rows)

  const metaRow = db.prepare('SELECT value FROM meta WHERE key = ?').get('taxonomy_managed')
  if (metaRow?.value) {
    try {
      const snapshot = JSON.parse(metaRow.value)
      if (migrateSharedTagsInSnapshot(snapshot)) {
        snapshot.updatedAt = new Date().toISOString()
        db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
          'taxonomy_managed',
          JSON.stringify(snapshot),
        )
      }
    } catch {
      /* ignore malformed taxonomy_managed */
    }
  }

  db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)').run(
    META_KEY_SHARED_TAGS_V2,
    JSON.stringify({ migratedRecords, at: new Date().toISOString() }),
  )
}

function migrateRecordsIndexColumns(db) {
  const cols = db.prepare('PRAGMA table_info(records)').all()
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('import_month')) {
    db.exec(`
      ALTER TABLE records ADD COLUMN import_month TEXT NOT NULL DEFAULT '';
      ALTER TABLE records ADD COLUMN data_source_type TEXT NOT NULL DEFAULT 'complaint_ticket';
      ALTER TABLE records ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'local';
      ALTER TABLE records ADD COLUMN import_batch_id TEXT NOT NULL DEFAULT '';
    `)
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_records_import_month ON records(import_month);
      CREATE INDEX IF NOT EXISTS idx_records_source ON records(data_source_type);
      CREATE INDEX IF NOT EXISTS idx_records_tenant ON records(tenant_id);
    `)
    const rows = db.prepare('SELECT id, payload FROM records').all()
    const stmt = db.prepare(
      `UPDATE records SET import_month = ?, data_source_type = ?, tenant_id = ?, import_batch_id = ? WHERE id = ?`,
    )
    const tx = db.transaction((items) => {
      for (const row of items) {
        const record = JSON.parse(row.payload)
        const idx = recordIndexFields(record)
        stmt.run(idx.importMonth, idx.dataSourceType, idx.tenantId, idx.importBatchId, row.id)
      }
    })
    tx(rows)
  }
}

export function initBusinessSchema() {
  const db = getDb()
  db.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS snapshots (
      id TEXT PRIMARY KEY,
      insight_period_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snapshots_period ON snapshots(insight_period_id);

    CREATE TABLE IF NOT EXISTS analysis_runs (
      id TEXT PRIMARY KEY,
      idempotency_key TEXT UNIQUE,
      insight_period_id TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_analysis_runs_period ON analysis_runs(insight_period_id);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      debug INTEGER NOT NULL DEFAULT 0,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);

    CREATE TABLE IF NOT EXISTS tag_candidates (
      id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      tag_type TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_tag_candidates_status ON tag_candidates(status);
    CREATE INDEX IF NOT EXISTS idx_tag_candidates_type ON tag_candidates(tag_type);

    CREATE TABLE IF NOT EXISTS meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS audit_log (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      username TEXT NOT NULL,
      action TEXT NOT NULL,
      detail_json TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
  `)
  migrateRecordsIndexColumns(db)
  migrateLegacyDcProductKeys(db)
  migrateProductCatalogCanonicalKeys(db)
  migrateSharedBandwidthToEipSpec(db)
  migrateSlbBuiltinJourneysInMeta(db)
  migrateBuiltinJourneysV2InMeta(db)
  migrateSharedTagsV2(db)
}

export { META_KEY_STORAGE_INIT }
