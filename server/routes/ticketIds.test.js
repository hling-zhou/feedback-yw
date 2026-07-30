import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-ticket-ids-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-ticket-ids-xxxxx'
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

function makeTicketRecord(id, dataSourceType, ticketId, importMonth) {
  return {
    id,
    dataSourceType,
    tenantId: 'local',
    schemaVersion: '2',
    recordStatus: 'analyzed',
    importedAt: '2026-05-01T00:00:00.000Z',
    importMonth,
    rawText: '受理内容',
    customerQuote: '',
    requestScene: '报障',
    problemType: '产品功能咨询',
    journeyL1: '使用',
    journeyL2: '监控',
    problemSummary: '痛点',
    sentiment: 'neutral',
    themes: ['监控'],
    status: 'open',
    ticketId,
    product: '云主机',
  }
}

const describeTicketIds = sqliteAvailable ? describe : describe.skip

describeTicketIds('ticket-ids API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'ticket_ids_editor',
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
          makeTicketRecord('rec-tid-1', 'complaint_ticket', 'T-GLOBAL-1', '2026-05'),
          makeTicketRecord('rec-tid-2', 'complaint_ticket', 'T-GLOBAL-1', '2026-06'),
          makeTicketRecord('rec-tid-3', 'complaint_ticket', '', '2026-06'),
          makeTicketRecord('rec-tid-4', 'consultation_ticket', 'T-GLOBAL-2', '2026-06'),
          makeTicketRecord('rec-tid-5', 'consultation_ticket', 'T-GLOBAL-3', '2026-06'),
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

  it('returns distinct non-empty ticketIds across all months', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/ticket-ids?dataSourceType=complaint_ticket',
      headers: authHeader('editor'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ticketIds).toEqual(['T-GLOBAL-1'])
  })

  it('scopes by dataSourceType', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/ticket-ids?dataSourceType=consultation_ticket',
      headers: authHeader('editor'),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).ticketIds.sort()).toEqual(['T-GLOBAL-2', 'T-GLOBAL-3'])
  })

  it('does not shadow the /records/:id route', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-tid-1',
      headers: authHeader('editor'),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).record.id).toBe('rec-tid-1')
  })

  it('PATCH 修改工单号为同类型已存在值时返回 409 TICKET_ID_CONFLICT', async () => {
    const getRes = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-tid-4',
      headers: authHeader('editor'),
    })
    const record = JSON.parse(getRes.body).record
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/storage/records/rec-tid-4',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { record: { ...record, ticketId: 'T-GLOBAL-3' } },
    })
    expect(res.statusCode).toBe(409)
    const body = JSON.parse(res.body)
    expect(body.code).toBe('TICKET_ID_CONFLICT')
    expect(body.error).toContain('T-GLOBAL-3')
  })
})
