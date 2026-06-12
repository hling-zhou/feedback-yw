import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-api-key-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-api-key'

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

describe.skipIf(!sqliteAvailable)('apiKeyRepository', () => {
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

  it('creates, verifies, and revokes api keys', async () => {
    const { apiKeyRepository } = await import('./apiKeyRepository.js')

    const created = apiKeyRepository.createApiKey({
      name: '需求系统',
      scopes: ['requirement_ticket_progress:import'],
      createdByUsername: 'admin',
    })
    expect(created.secret.startsWith('fi_live_')).toBe(true)
    expect(created.apiKey.keyPrefix).toBeTruthy()

    const verified = apiKeyRepository.verifyApiKey(created.secret)
    expect(verified?.id).toBe(created.apiKey.id)
    expect(verified?.lastUsedAt).toBeTruthy()

    const listed = apiKeyRepository.listApiKeys()
    expect(listed.some((item) => item.id === created.apiKey.id)).toBe(true)

    apiKeyRepository.revokeApiKey(created.apiKey.id)
    expect(apiKeyRepository.verifyApiKey(created.secret)).toBeNull()
  })

  it('rejects invalid or duplicate scope input on create', async () => {
    const { apiKeyRepository } = await import('./apiKeyRepository.js')

    expect(() =>
      apiKeyRepository.createApiKey({
        name: 'empty-scope',
        scopes: [],
      }),
    ).toThrow(/至少选择一个权限范围/)
  })
})
