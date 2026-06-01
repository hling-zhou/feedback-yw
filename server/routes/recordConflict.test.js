import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-record-conflict-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-record-conflict-xx'
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
/** @type {Record<string, string>} */
let tokens = {}

function authHeader(role) {
  return { authorization: `Bearer ${tokens[role]}` }
}

const sampleRecord = {
  id: 'rec-conflict-1',
  dataSourceType: 'complaint_ticket',
  tenantId: 'local',
  schemaVersion: '2',
  recordStatus: 'analyzed',
  importedAt: '2026-05-01T00:00:00.000Z',
  importMonth: '2026-05',
  rawText: '受理内容',
  customerQuote: '',
  requestScene: '报障',
  problemType: '产品功能咨询',
  journeyL1: '使用',
  journeyL2: '监控',
  problemSummary: '痛点',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  sentiment: 'neutral',
  themes: ['监控'],
  status: 'open',
  ticketId: 'T-CONFLICT-1',
}

const describeConflict = sqliteAvailable ? describe : describe.skip

describeConflict('record revision conflict (P0)', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'record_editor',
      password: 'EditorPass12345!',
      team: '测试',
      role: 'editor',
    })
    tokens = { editor: signAccessToken(editor) }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerStorageRoutes } = await import('./storage.js')

    app = Fastify()
    registerAuthHooks(app)
    registerStorageRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('first save assigns recordRevision 1', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/storage/records/rec-conflict-1',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { record: sampleRecord, expectedRevision: 0 },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.recordRevision).toBe(1)

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-conflict-1',
      headers: authHeader('editor'),
    })
    const record = JSON.parse(getRes.body).record
    expect(record.recordRevision).toBe(1)
    expect(record.updatedBy?.username).toBe('record_editor')
  })

  it('returns 409 when expectedRevision is stale', async () => {
    const staleRes = await app.inject({
      method: 'PATCH',
      url: '/api/storage/records/rec-conflict-1',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        record: { ...sampleRecord, note: 'A 的修改' },
        expectedRevision: 0,
      },
    })
    expect(staleRes.statusCode).toBe(409)
    const staleBody = JSON.parse(staleRes.body)
    expect(staleBody.code).toBe('RECORD_CONFLICT')
    expect(staleBody.currentRevision).toBe(1)

    const okRes = await app.inject({
      method: 'PATCH',
      url: '/api/storage/records/rec-conflict-1',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        record: { ...sampleRecord, note: '基于最新保存' },
        expectedRevision: 1,
      },
    })
    expect(okRes.statusCode).toBe(200)
    expect(JSON.parse(okRes.body).recordRevision).toBe(2)
  })
})
