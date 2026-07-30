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
const META_KEY_SHARED_TAGS_V3 = 'migrate_shared_tags_v3_problem_types_12'

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

function migrateSharedTagsV3(db) {
  const done = db.prepare('SELECT value FROM meta WHERE key = ?').get(META_KEY_SHARED_TAGS_V3)
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
    META_KEY_SHARED_TAGS_V3,
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

/**
 * records.ticket_id 提取列 + (tenant_id, data_source_type, ticket_id) 唯一索引。
 * 历史重复组：每组仅保留一条带 ticket_id（id 最小者），其余置 NULL——payload 不动，
 * 保证建索引不丢数据；空工单号一律 NULL（唯一索引下多行 NULL 互不冲突）。
 */
function migrateRecordsTicketIdColumn(db) {
  const cols = db.prepare('PRAGMA table_info(records)').all()
  const names = new Set(cols.map((c) => c.name))
  if (!names.has('ticket_id')) {
    const tx = db.transaction(() => {
      db.exec(`ALTER TABLE records ADD COLUMN ticket_id TEXT`)
      db.prepare(
        `UPDATE records SET ticket_id = NULLIF(trim(json_extract(payload, '$.ticketId')), '')`,
      ).run()
      db.prepare(
        `UPDATE records SET ticket_id = NULL
         WHERE ticket_id IS NOT NULL AND id NOT IN (
           SELECT MIN(id) FROM records WHERE ticket_id IS NOT NULL
           GROUP BY tenant_id, data_source_type, ticket_id
         )`,
      ).run()
    })
    tx()
  }
  db.exec(
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_records_ticket_unique
     ON records(tenant_id, data_source_type, ticket_id)`,
  )
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

    CREATE TABLE IF NOT EXISTS insight_rebuild_jobs (
      id TEXT PRIMARY KEY,
      insight_period_id TEXT NOT NULL,
      idempotency_key TEXT,
      status TEXT NOT NULL,
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_insight_rebuild_jobs_period ON insight_rebuild_jobs(insight_period_id);
    CREATE INDEX IF NOT EXISTS idx_insight_rebuild_jobs_idempotency ON insight_rebuild_jobs(idempotency_key);

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

    CREATE TABLE IF NOT EXISTS action_items (
      id TEXT PRIMARY KEY,
      product_key TEXT NOT NULL DEFAULT '',
      product_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL,
      first_proposed_at TEXT NOT NULL DEFAULT '',
      schedule_at TEXT NOT NULL DEFAULT '',
      warning_level TEXT NOT NULL DEFAULT 'none',
      payload TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_action_items_product ON action_items(product_key);
    CREATE INDEX IF NOT EXISTS idx_action_items_status ON action_items(status);
    CREATE INDEX IF NOT EXISTS idx_action_items_first_proposed ON action_items(first_proposed_at);

    CREATE TABLE IF NOT EXISTS message_bottles (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      username TEXT NOT NULL,
      content TEXT NOT NULL,
      attachments_json TEXT NOT NULL DEFAULT '[]',
      progress TEXT NOT NULL DEFAULT '待处理',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS user_ticket_review (
      user_id TEXT NOT NULL,
      record_id TEXT NOT NULL,
      source TEXT NOT NULL CHECK(source IN ('manual', 'save')),
      marked_at TEXT NOT NULL,
      PRIMARY KEY (user_id, record_id)
    );
    CREATE INDEX IF NOT EXISTS idx_user_ticket_review_user
      ON user_ticket_review (user_id, marked_at DESC);
    CREATE INDEX IF NOT EXISTS idx_message_bottles_created ON message_bottles(created_at DESC);

    CREATE TABLE IF NOT EXISTS requirement_ticket_progress (
      ticket_id TEXT PRIMARY KEY,
      product TEXT NOT NULL DEFAULT '',
      schedule_at TEXT NOT NULL DEFAULT '',
      workflow_status TEXT NOT NULL DEFAULT '',
      imported_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_requirement_ticket_progress_product
      ON requirement_ticket_progress (product);
    CREATE INDEX IF NOT EXISTS idx_requirement_ticket_progress_workflow_status
      ON requirement_ticket_progress (workflow_status);

    CREATE TABLE IF NOT EXISTS requirement_status_mapping (
      workflow_status TEXT PRIMARY KEY,
      maps_to_action_status TEXT NOT NULL,
      sort_order INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      key_prefix TEXT NOT NULL,
      key_hash TEXT NOT NULL UNIQUE,
      scopes_json TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'revoked')),
      created_by_user_id TEXT,
      created_by_username TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      last_used_at TEXT,
      expires_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_api_keys_prefix ON api_keys(key_prefix);
    CREATE INDEX IF NOT EXISTS idx_api_keys_status ON api_keys(status);
  `)
  migrateRecordsIndexColumns(db)
  migrateRecordsTicketIdColumn(db)
  migrateLegacyDcProductKeys(db)
  migrateProductCatalogCanonicalKeys(db)
  migrateSharedBandwidthToEipSpec(db)
  migrateSlbBuiltinJourneysInMeta(db)
  migrateBuiltinJourneysV2InMeta(db)
  migrateSharedTagsV2(db)
  migrateSharedTagsV3(db)
}

export { META_KEY_STORAGE_INIT }
