import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-audit-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-audit-log-xx'

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

describe.skipIf(!sqliteAvailable)('audit log', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
  })

  it('writes and lists entries newest first', async () => {
    const { logAudit, listAuditLogs } = await import('./audit.js')
    logAudit({
      userId: 'u1',
      username: 'admin',
      action: 'storage.import_batch',
      detail: { count: 3 },
    })
    logAudit({
      userId: 'u1',
      username: 'admin',
      action: 'user.create',
      detail: { username: 'viewer1' },
    })

    const entries = listAuditLogs(7)
    expect(entries.length).toBeGreaterThanOrEqual(2)
    expect(entries[0].action).toBe('user.create')
    expect(entries[1].action).toBe('storage.import_batch')
    expect(entries[0].detail).toMatchObject({ username: 'viewer1' })
  })

  it('excludes entries older than the requested window', async () => {
    const { getDb } = await import('./db.js')
    const { listAuditLogs } = await import('./audit.js')
    const db = getDb()
    const oldAt = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000).toISOString()
    db.prepare(
      `INSERT INTO audit_log (id, user_id, username, action, detail_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      'old-entry',
      null,
      'system',
      'user.delete',
      '{}',
      oldAt,
    )

    const entries = listAuditLogs(7)
    expect(entries.some((e) => e.id === 'old-entry')).toBe(false)
  })
})
