import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-month-summary-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-month-summary-xxxx'
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

function makeRecord(id, dataSourceType, importMonth, tenantId = 'local') {
  return {
    id,
    dataSourceType,
    tenantId,
    schemaVersion: '2',
    recordStatus: 'analyzed',
    importedAt: '2026-05-01T00:00:00.000Z',
    importMonth,
    rawText: '受理内容',
    sentiment: 'neutral',
    status: 'open',
    ticketId: '',
    product: '云主机',
  }
}

const describeMonthSummary = sqliteAvailable ? describe : describe.skip

describeMonthSummary('month-summary API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'month_summary_editor',
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

    await app.inject({
      method: 'POST',
      url: '/api/storage/records/batch',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        records: [
          makeRecord('rec-ms-1', 'complaint_ticket', '2026-05'),
          makeRecord('rec-ms-2', 'complaint_ticket', '2026-06'),
          makeRecord('rec-ms-3', 'consultation_ticket', '2026-06'),
          makeRecord('rec-ms-4', 'post_use_rating', '2026-06'),
          // 无 importMonth 且无 createdAt：不计入聚合
          { ...makeRecord('rec-ms-5', 'complaint_ticket', ''), createdAt: undefined, importMonth: '' },
          makeRecord('rec-ms-6', 'complaint_ticket', '2026-05', 'other-tenant'),
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

  it('按月份升序聚合并给出 total', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/month-summary',
      headers: authHeader('editor'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.months).toEqual([
      { importMonth: '2026-05', count: 2 },
      { importMonth: '2026-06', count: 3 },
    ])
    expect(body.total).toBe(5)
  })

  it('bySource 包含 月份×数据源 明细', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/month-summary',
      headers: authHeader('editor'),
    })
    const bySource = JSON.parse(res.body).bySource
    const key = (r) => `${r.dataSourceType}@${r.importMonth}=${r.count}`
    expect(bySource.map(key).sort()).toEqual([
      'complaint_ticket@2026-05=2',
      'complaint_ticket@2026-06=1',
      'consultation_ticket@2026-06=1',
      'post_use_rating@2026-06=1',
    ])
  })

  it('tenantId 参数隔离租户数据', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/month-summary?tenantId=local',
      headers: authHeader('editor'),
    })
    const body = JSON.parse(res.body)
    expect(body.months).toEqual([
      { importMonth: '2026-05', count: 1 },
      { importMonth: '2026-06', count: 3 },
    ])
    expect(body.total).toBe(4)

    const empty = await app.inject({
      method: 'GET',
      url: '/api/storage/records/month-summary?tenantId=nobody',
      headers: authHeader('editor'),
    })
    expect(JSON.parse(empty.body)).toEqual({ months: [], bySource: [], total: 0 })
  })

  it('未授权请求返回 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/storage/records/month-summary' })
    expect(res.statusCode).toBe(401)
  })

  it('不影响 /records/:id 路由匹配', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-ms-1',
      headers: authHeader('editor'),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).record.id).toBe('rec-ms-1')
  })
})
