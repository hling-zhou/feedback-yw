import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-bottle-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-message-bottle'

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

describe.skipIf(!sqliteAvailable)('messageBottleRepository', () => {
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

  it('creates, lists and updates progress', async () => {
    const { messageBottleRepository } = await import('./messageBottleRepository.js')
    const created = messageBottleRepository.create({
      userId: 'u1',
      username: 'alice',
      content: '希望增加导出模板',
      attachments: [
        {
          dataUrl: 'data:image/png;base64,abcd',
          fileName: 'shot.png',
          mimeType: 'image/png',
          size: 4,
        },
      ],
    })
    expect(created.progress).toBe('待处理')

    const listed = messageBottleRepository.list({ limit: 10 })
    expect(listed.total).toBeGreaterThanOrEqual(1)
    expect(listed.items.some((item) => item.id === created.id)).toBe(true)

    const updated = messageBottleRepository.updateProgress(created.id, '处理中')
    expect(updated?.progress).toBe('处理中')
  })
})
