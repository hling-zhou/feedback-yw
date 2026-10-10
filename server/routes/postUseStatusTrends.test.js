import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-status-trends-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-post-use-status-xxxx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('../db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

/** @type {import('fastify').FastifyInstance} */
let app
let token = ''

function ratingRecord(id, overrides = {}) {
  return {
    id,
    dataSourceType: 'post_use_rating',
    tenantId: 'local',
    schemaVersion: '2',
    recordStatus: 'analyzed',
    importedAt: '2026-06-01T00:00:00.000Z',
    importMonth: '2026-06',
    productName: '弹性公网IP',
    channel: 'sms',
    ratingScore: 10,
    ...overrides,
  }
}

const describeTrends = sqliteAvailable ? describe : describe.skip

describeTrends('post-use status trends API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'post_use_trends_editor',
      password: 'EditorPass12345!',
      team: '产品运营组',
      role: 'editor',
    })
    token = signAccessToken(editor)

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerStorageRoutes } = await import('./storage.js')
    app = Fastify()
    registerAuthHooks(app)
    registerStorageRoutes(app)
    await app.ready()

    await app.inject({
      method: 'POST',
      url: '/api/storage/records/batch',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        records: [
          ratingRecord('pur-1', { importMonth: '2026-06', ratingScore: 8 }),
          ratingRecord('pur-2', { importMonth: '2026-06', ratingScore: 10 }),
          ratingRecord('pur-3', { importMonth: '2026-06', channel: 'callback', ratingScore: 10 }),
          ratingRecord('pur-4', { importMonth: '2026-08', channel: 'console', ratingScore: 9 }),
          ratingRecord('pur-5', { importMonth: '2026-06', productName: '云主机', ratingScore: 6 }),
        ],
      },
    })
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns monthly department and company averages without listing each record', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/post-use-status-trends',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.pending).toBe(false)
    expect(body.experience.data.map((row) => row.date)).toEqual(expect.arrayContaining(['2026-06', '2026-08']))
    const june = body.experience.data.find((row) => row.date === '2026-06')
    expect(june.departmentScore).toBe(9)
    const mixedJune = body.threeChannel.data.find((row) => row.date === '2026-06')
    expect(mixedJune.department).toBe(9.33)
    expect(mixedJune.company).toBe(8.5)
    expect(body.companyMetrics.find((row) => row.date === '2026-06')).toEqual({
      date: '2026-06',
      avgScore: 8.5,
      totalSample: 4,
      productCount: 2,
      scoreSum: 34,
    })
  })
})
