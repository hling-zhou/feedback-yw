import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-revision-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-records-revision-xx'

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

describe.skipIf(!sqliteAvailable)('dataRevision recordsRevision', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
  })

  it('increments recordsRevision only for record-side bumps', async () => {
    const { bumpDataRevision, bumpRecordsRevision, getDataRevision } = await import('./dataRevision.js')
    const start = getDataRevision()
    bumpDataRevision()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const afterAction = getDataRevision()
    expect(afterAction.revision).toBeGreaterThan(start.revision)
    expect(afterAction.recordsRevision).toBe(start.recordsRevision)

    bumpRecordsRevision()
    await new Promise((resolve) => setTimeout(resolve, 500))
    const afterRecords = getDataRevision()
    expect(afterRecords.revision).toBeGreaterThan(afterAction.revision)
    expect(afterRecords.recordsRevision).toBe(afterAction.recordsRevision + 1)
  })
})
