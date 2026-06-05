import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { SATISFACTION_CALLBACK_REPORT_COLUMNS as COLS } from '../../src/domain/followUpSatisfaction.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-follow-up-import-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-follow-up-import-xx'
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

const ticketRecord = {
  id: 'rec-fu-ticket-1',
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
  ticketId: 'T-FU-API-1',
  product: '云主机',
}

/**
 * @param {Record<string, string>} [overrides]
 */
function makeFollowUpRow(overrides = {}) {
  return {
    [COLS.followUpTicketId]: 'FH-API-001',
    [COLS.originalTicketId]: 'T-FU-API-1',
    [COLS.followUpSuccessful]: '是',
    [COLS.problemResolved]: '是',
    [COLS.score]: '10',
    ...overrides,
  }
}

const describeFollowUp = sqliteAvailable ? describe : describe.skip

describeFollowUp('follow-up satisfaction import API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'follow_up_editor',
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
      payload: { records: [ticketRecord] },
    })
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('dryRun previews match without persisting', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/follow-up-satisfaction/import',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        importMonth: '2026-06',
        rows: [makeFollowUpRow()],
        dryRun: true,
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.dryRun).toBe(true)
    expect(body.appliedRowCount).toBe(1)
    expect(body.updatedRecordCount).toBe(1)

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-fu-ticket-1',
      headers: authHeader('editor'),
    })
    const saved = JSON.parse(getRes.body).record
    expect(saved.followUpSatisfaction).toBeUndefined()
  })

  it('imports follow-up and patches matched ticket', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/follow-up-satisfaction/import',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        importMonth: '2026-06',
        rows: [makeFollowUpRow({ [COLS.score]: '9', [COLS.problemResolved]: '否' })],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.updatedRecordCount).toBe(1)
    expect(body.appliedRowCount).toBe(1)

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-fu-ticket-1',
      headers: authHeader('editor'),
    })
    const saved = JSON.parse(getRes.body).record
    expect(saved.ticketId).toBe('T-FU-API-1')
    expect(saved.requestScene).toBe('报障')
    expect(saved.followUpSatisfaction?.followUpTicketId).toBe('FH-API-001')
    expect(saved.followUpSatisfaction?.score).toBe(9)
    expect(saved.followUpSatisfaction?.importMonth).toBe('2026-06')
  })

  it('idempotent re-import with same followUpTicketId updates score', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/follow-up-satisfaction/import',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        importMonth: '2026-06',
        rows: [makeFollowUpRow({ [COLS.score]: '8' })],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.idempotentUpdateCount).toBe(1)

    const getRes = await app.inject({
      method: 'GET',
      url: '/api/storage/records/rec-fu-ticket-1',
      headers: authHeader('editor'),
    })
    expect(JSON.parse(getRes.body).record.followUpSatisfaction?.score).toBe(8)
  })

  it('returns unmatched rows for unknown ticket id', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/follow-up-satisfaction/import',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        importMonth: '2026-06',
        rows: [
          makeFollowUpRow({
            [COLS.followUpTicketId]: 'FH-MISSING',
            [COLS.originalTicketId]: 'NO-SUCH-TICKET',
          }),
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.updatedRecordCount).toBe(0)
    expect(body.unmatched).toHaveLength(1)
    expect(body.unmatched[0].reason).toContain('未找到')
  })
})
