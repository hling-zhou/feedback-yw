import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-record-projection-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-record-projection-xxxx'
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

function makeRecord(id, importMonth = '2026-05') {
  return {
    id,
    dataSourceType: 'complaint_ticket',
    tenantId: 'local',
    schemaVersion: '2',
    recordStatus: 'analyzed',
    importedAt: '2026-05-01T00:00:00.000Z',
    importMonth,
    rawText: '受理内容'.repeat(50),
    handlingText: '处理意见'.repeat(50),
    customerQuote: '客户原话'.repeat(20),
    responseText: '优化建议'.repeat(20),
    sourceColumns: { 受理内容: '受理内容'.repeat(50), 处理意见: '处理意见'.repeat(50) },
    sentiment: 'neutral',
    status: 'open',
    ticketId: `T-${id}`,
    product: '云主机',
    requestScene: '报障',
    problemType: '产品功能咨询',
    journeyL1: '使用',
    journeyL2: '监控',
    customerRequest: '客户请求摘要',
    painPoint: '痛点',
  }
}

const describeProjection = sqliteAvailable ? describe : describe.skip

describeProjection('records payload projection', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'projection_editor',
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
          makeRecord('rec-proj-1', '2026-05'),
          makeRecord('rec-proj-2', '2026-06'),
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

  it('fields=list 剔除 5 个大文本字段，保留其余字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records?fields=list&limit=10',
      headers: authHeader('editor'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.records.length).toBeGreaterThanOrEqual(2)
    const r = body.records[0]
    expect(r).toHaveProperty('id')
    expect(r).toHaveProperty('ticketId')
    expect(r).toHaveProperty('product')
    expect(r).toHaveProperty('requestScene')
    expect(r).toHaveProperty('customerRequest')
    expect(r).toHaveProperty('painPoint')
    expect(r).not.toHaveProperty('rawText')
    expect(r).not.toHaveProperty('handlingText')
    expect(r).not.toHaveProperty('customerQuote')
    expect(r).not.toHaveProperty('responseText')
    expect(r).not.toHaveProperty('sourceColumns')
  })

  it('fields=full 原样返回大文本字段', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records?fields=full&limit=10',
      headers: authHeader('editor'),
    })
    const body = JSON.parse(res.body)
    const r = body.records[0]
    expect(r).toHaveProperty('rawText')
    expect(r).toHaveProperty('handlingText')
    expect(r).toHaveProperty('customerQuote')
    expect(r).toHaveProperty('responseText')
    expect(r).toHaveProperty('sourceColumns')
  })

  it('默认（不传 fields）原样返回', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records?limit=10',
      headers: authHeader('editor'),
    })
    const body = JSON.parse(res.body)
    expect(body.records[0]).toHaveProperty('rawText')
  })

  it('fields=list 与 full 的 total 一致', async () => {
    const [listRes, fullRes] = await Promise.all([
      app.inject({
        method: 'GET',
        url: '/api/storage/records?fields=list',
        headers: authHeader('editor'),
      }),
      app.inject({
        method: 'GET',
        url: '/api/storage/records?fields=full',
        headers: authHeader('editor'),
      }),
    ])
    expect(JSON.parse(listRes.body).total).toBe(JSON.parse(fullRes.body).total)
  })

  it('单条 GET /records/:id 始终全量', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-proj-1',
      headers: authHeader('editor'),
    })
    const r = JSON.parse(res.body).record
    expect(r).toHaveProperty('rawText')
    expect(r).toHaveProperty('handlingText')
    expect(r).toHaveProperty('sourceColumns')
  })
})
