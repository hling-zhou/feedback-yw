import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-health-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-health-check-xx'

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

describe.skipIf(!sqliteAvailable)('buildHealthReport', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { storageRepository } = await import('./storageRepository.js')
    const { bumpDataRevision } = await import('./dataRevision.js')
    storageRepository.replaceAllRecords([
      {
        id: 'r1',
        schemaVersion: '2.0',
        tenantId: 'local',
        dataSourceType: 'complaint_ticket',
        recordStatus: 'analyzed',
        rawText: 'test',
        importMonth: '2025-01',
        importBatchId: 'b1',
      },
    ])
    bumpDataRevision()
    await new Promise((r) => setTimeout(r, 500))
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
  })

  it('returns dbOk, recordCount and revision', async () => {
    const { buildHealthReport } = await import('./health.js')
    const report = buildHealthReport()
    expect(report.dbOk).toBe(true)
    expect(report.ok).toBe(true)
    expect(report.recordCount).toBeGreaterThanOrEqual(1)
    expect(report.revision).toBeGreaterThanOrEqual(1)
    expect(report.revisionUpdatedAt).toBeTruthy()
  })
})

