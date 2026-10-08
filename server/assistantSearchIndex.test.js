import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-assistant-search-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-assistant-search-xx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('./db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

const describeSearch = sqliteAvailable ? describe : describe.skip

describeSearch('assistantSearchIndex', () => {
  /** @type {import('./assistantSearchIndex.js')} */
  let index
  /** @type {import('./storageRepository.js').storageRepository} */
  let storage

  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
    index = await import('./assistantSearchIndex.js')
    index.initSearchIndex()
    const storageMod = await import('./storageRepository.js')
    storage = storageMod.storageRepository
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('indexes records on put and returns matches filtered by month and source', () => {
    storage.putRecord({
      id: 'rec-search-1',
      ticketId: 'C-9001',
      dataSourceType: 'complaint_ticket',
      tenantId: 'local',
      schemaVersion: 1,
      recordStatus: 'analyzed',
      importMonth: '2026-08',
      product: 'VPC',
      painPoint: 'NAT 网关超时导致连接失败',
      handlingText: '已建议客户检查安全组规则',
    })

    const results = index.searchRecords({
      importMonth: '2026-08',
      dataSourceType: 'complaint_ticket',
      query: '网关超时',
      limit: 15,
    })
    expect(results.length).toBeGreaterThanOrEqual(1)
    expect(results[0].ticketId).toBe('C-9001')
    expect(results[0].matchedField).toBeTruthy()
    expect(results[0].snippet).toContain('网关超时')
  })

  it('filters by import_month', () => {
    storage.putRecord({
      id: 'rec-search-2',
      ticketId: 'C-9002',
      dataSourceType: 'complaint_ticket',
      tenantId: 'local',
      schemaVersion: 1,
      recordStatus: 'analyzed',
      importMonth: '2026-07',
      product: 'VPC',
      painPoint: '另一个网关超时案例',
    })
    const inAug = index.searchRecords({
      importMonth: '2026-08',
      dataSourceType: 'complaint_ticket',
      query: '网关超时',
    })
    const inJul = index.searchRecords({
      importMonth: '2026-07',
      dataSourceType: 'complaint_ticket',
      query: '网关超时',
    })
    expect(inAug.find((r) => r.recordId === 'rec-search-2')).toBeUndefined()
    expect(inJul.find((r) => r.recordId === 'rec-search-2')).toBeDefined()
  })

  it('returns empty for queries shorter than 3 chars', () => {
    const results = index.searchRecords({
      importMonth: '2026-08',
      dataSourceType: 'complaint_ticket',
      query: '超时',
    })
    expect(results).toEqual([])
  })

  it('removes index on deleteRecord', () => {
    storage.putRecord({
      id: 'rec-search-del',
      ticketId: 'C-9003',
      dataSourceType: 'complaint_ticket',
      tenantId: 'local',
      schemaVersion: 1,
      recordStatus: 'analyzed',
      importMonth: '2026-08',
      product: 'VPC',
      painPoint: '待删除的网关超时记录',
    })
    expect(
      index
        .searchRecords({ importMonth: '2026-08', dataSourceType: 'complaint_ticket', query: '网关超时' })
        .find((r) => r.recordId === 'rec-search-del'),
    ).toBeDefined()
    storage.deleteRecord('rec-search-del')
    expect(
      index
        .searchRecords({ importMonth: '2026-08', dataSourceType: 'complaint_ticket', query: '网关超时' })
        .find((r) => r.recordId === 'rec-search-del'),
    ).toBeUndefined()
  })
})
