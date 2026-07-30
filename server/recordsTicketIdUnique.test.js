import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-ticket-unique-'))
const dbPath = path.join(tmpDir, 'test.db')
process.env.AUTH_DATABASE_PATH = dbPath
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-ticket-unique-xx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

let sqliteAvailable = false
try {
  const probe = new Database(dbPath)
  probe.close()
  fs.rmSync(dbPath, { force: true })
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

function makePayload(id, ticketId, extra = {}) {
  return JSON.stringify({
    id,
    tenantId: 'local',
    dataSourceType: 'complaint_ticket',
    importMonth: '2026-05',
    ticketId,
    rawText: '受理内容',
    ...extra,
  })
}

/**
 * 以迁移前 schema（无 ticket_id 列）构造库，插入历史重复数据后关闭，
 * 交由 getDb() 触发 migrateRecordsTicketIdColumn。
 */
function seedLegacyDatabase() {
  const raw = new Database(dbPath)
  raw.exec(`
    CREATE TABLE IF NOT EXISTS records (
      id TEXT PRIMARY KEY,
      payload TEXT NOT NULL,
      import_month TEXT NOT NULL DEFAULT '',
      data_source_type TEXT NOT NULL DEFAULT 'complaint_ticket',
      tenant_id TEXT NOT NULL DEFAULT 'local',
      import_batch_id TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `)
  const insert = raw.prepare(
    `INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id)
     VALUES (?, ?, ?, ?, ?, ?)`,
  )
  insert.run('rec-dup-a', makePayload('rec-dup-a', 'T-DUP-1'), '2026-05', 'complaint_ticket', 'local', '')
  insert.run('rec-dup-b', makePayload('rec-dup-b', 'T-DUP-1'), '2026-06', 'complaint_ticket', 'local', '')
  insert.run('rec-empty', makePayload('rec-empty', ''), '2026-06', 'complaint_ticket', 'local', '')
  insert.run(
    'rec-consult',
    makePayload('rec-consult', 'T-DUP-1', { dataSourceType: 'consultation_ticket', importMonth: '2026-06' }),
    '2026-06',
    'consultation_ticket',
    'local',
    '',
  )
  raw.close()
}

const describeUnique = sqliteAvailable ? describe : describe.skip

describeUnique('records ticket_id 唯一索引', () => {
  /** @type {import('better-sqlite3').Database} */
  let db
  /** @type {import('./storageRepository.js').storageRepository} */
  let storageRepository

  beforeAll(async () => {
    seedLegacyDatabase()
    const dbModule = await import('./db.js')
    dbModule.closeDb()
    db = dbModule.getDb()
    storageRepository = (await import('./storageRepository.js')).storageRepository
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('迁移创建 ticket_id 列与唯一索引', () => {
    const cols = db.prepare('PRAGMA table_info(records)').all().map((c) => c.name)
    expect(cols).toContain('ticket_id')
    const indexes = db.prepare('PRAGMA index_list(records)').all()
    const unique = indexes.find((i) => i.name === 'idx_records_ticket_unique')
    expect(unique).toBeTruthy()
    expect(unique.unique).toBe(1)
  })

  it('历史重复组仅保留一条 ticket_id，其余置 NULL 且 payload 不动', () => {
    const rows = db
      .prepare(
        `SELECT id, payload, ticket_id FROM records
         WHERE data_source_type = 'complaint_ticket' AND json_extract(payload, '$.ticketId') = 'T-DUP-1'
         ORDER BY id`,
      )
      .all()
    expect(rows).toHaveLength(2)
    const withColumn = rows.filter((r) => r.ticket_id === 'T-DUP-1')
    const nulled = rows.filter((r) => r.ticket_id === null)
    expect(withColumn).toHaveLength(1)
    expect(nulled).toHaveLength(1)
    // payload 中的 ticketId 原样保留
    expect(JSON.parse(nulled[0].payload).ticketId).toBe('T-DUP-1')
    // canonical 保留 id 最小者
    expect(withColumn[0].id).toBe('rec-dup-a')
  })

  it('空工单号与其他数据类型的同号记录不受影响', () => {
    expect(db.prepare(`SELECT ticket_id FROM records WHERE id = 'rec-empty'`).get().ticket_id).toBeNull()
    expect(db.prepare(`SELECT ticket_id FROM records WHERE id = 'rec-consult'`).get().ticket_id).toBe(
      'T-DUP-1',
    )
  })

  it('listTicketIdsBySourceType 基于 ticket_id 列返回去重集合', () => {
    expect(storageRepository.listTicketIdsBySourceType('complaint_ticket')).toEqual(['T-DUP-1'])
    expect(storageRepository.listTicketIdsBySourceType('consultation_ticket')).toEqual(['T-DUP-1'])
  })

  it('putRecords 跳过同号新记录并计数', () => {
    const result = storageRepository.putRecords([
      {
        id: 'rec-new-dup',
        tenantId: 'local',
        dataSourceType: 'complaint_ticket',
        importMonth: '2026-07',
        ticketId: 'T-DUP-1',
        rawText: '重复导入',
      },
    ])
    expect(result.written).toBe(0)
    expect(result.skippedTicketConflicts).toBe(1)
    expect(storageRepository.getRecord('rec-new-dup')).toBeNull()
  })

  it('putRecord 修改工单号为已存在值时报 TICKET_ID_CONFLICT', () => {
    storageRepository.putRecord({
      id: 'rec-edit-1',
      tenantId: 'local',
      dataSourceType: 'complaint_ticket',
      importMonth: '2026-07',
      ticketId: 'T-EDIT-1',
      rawText: '原始',
    })
    const other = storageRepository.getRecord('rec-dup-b')
    expect(() =>
      storageRepository.putRecord({ ...other, ticketId: 'T-EDIT-1' }),
    ).toThrowError(/已存在/)
    try {
      storageRepository.putRecord({ ...other, ticketId: 'T-EDIT-1' })
    } catch (err) {
      expect(err.code).toBe('TICKET_ID_CONFLICT')
    }
  })

  it('历史置 NULL 行编辑非工单号字段可正常保存', () => {
    const nulled = storageRepository.getRecord('rec-dup-b')
    const result = storageRepository.putRecord({ ...nulled, rawText: '修正后的内容' })
    expect(result.record.rawText).toBe('修正后的内容')
    // 列值保持 NULL，payload 工单号不变
    expect(
      db.prepare(`SELECT ticket_id FROM records WHERE id = 'rec-dup-b'`).get().ticket_id,
    ).toBeNull()
    expect(storageRepository.getRecord('rec-dup-b').ticketId).toBe('T-DUP-1')
  })

  it('历史置 NULL 行改为全新工单号后正常占用索引', () => {
    const nulled = storageRepository.getRecord('rec-dup-b')
    storageRepository.putRecord({ ...nulled, ticketId: 'T-EDIT-2' })
    expect(
      db.prepare(`SELECT ticket_id FROM records WHERE id = 'rec-dup-b'`).get().ticket_id,
    ).toBe('T-EDIT-2')
  })
})
