import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-ticket-review-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-ticket-review'

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

describe.skipIf(!sqliteAvailable)('userTicketReviewRepository', () => {
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
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('marks done, lists, updates source, and deletes on unmark', async () => {
    const { userTicketReviewRepository } = await import('./userTicketReviewRepository.js')

    const first = userTicketReviewRepository.markDone('u1', 'rec-1', 'save')
    expect(first.source).toBe('save')
    expect(first.recordId).toBe('rec-1')

    let listed = userTicketReviewRepository.listByUserId('u1')
    expect(listed).toHaveLength(1)
    expect(listed[0].recordId).toBe('rec-1')

    const updated = userTicketReviewRepository.markDone('u1', 'rec-1', 'manual')
    expect(updated.source).toBe('manual')

    listed = userTicketReviewRepository.listByUserId('u1')
    expect(listed).toHaveLength(1)
    expect(listed[0].source).toBe('manual')

    const deleted = userTicketReviewRepository.unmark('u1', 'rec-1')
    expect(deleted).toBe(true)
    expect(userTicketReviewRepository.listByUserId('u1')).toHaveLength(0)

    expect(userTicketReviewRepository.unmark('u1', 'rec-1')).toBe(false)
  })

  it('isolates reviews per user', async () => {
    const { userTicketReviewRepository } = await import('./userTicketReviewRepository.js')

    userTicketReviewRepository.markDone('u1', 'rec-a', 'manual')
    userTicketReviewRepository.markDone('u2', 'rec-b', 'save')

    expect(userTicketReviewRepository.listByUserId('u1').map((row) => row.recordId)).toEqual(['rec-a'])
    expect(userTicketReviewRepository.listByUserId('u2').map((row) => row.recordId)).toEqual(['rec-b'])
  })
})
