import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-req-import-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-req-import-api'
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
/** @type {string} */
let adminToken = ''
/** @type {string} */
let apiKeySecret = ''

const describeApi = sqliteAvailable ? describe : describe.skip

describeApi('requirement ticket progress import via API key', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const { registerAuthHooks } = await import('../middleware.js')
    const { registerSchemaErrorHandler } = await import('../registerSchemaErrorHandler.js')
    const { registerRequirementTicketProgressRoutes } = await import('./requirementTicketProgress.js')
    const { registerApiKeyRoutes } = await import('./apiKeys.js')
    const { FASTIFY_SCHEMA_OPTIONS } = await import('../schemas/common.js')

    const admin = await createUser({
      username: 'req_import_admin',
      password: 'AdminPass12345!',
      team: '管理',
      role: 'admin',
    })
    adminToken = signAccessToken(admin, 0)

    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerSchemaErrorHandler(app)
    registerAuthHooks(app)
    registerRequirementTicketProgressRoutes(app)
    registerApiKeyRoutes(app)
    await app.ready()

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/api-keys',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        name: 'integration',
        scopes: ['requirement_ticket_progress:import'],
      },
    })
    expect(createRes.statusCode).toBe(201)
    apiKeySecret = createRes.json().secret
  })

  afterAll(async () => {
    if (app) await app.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('imports rows with bearer api key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement-ticket-progress/import',
      headers: { authorization: `Bearer ${apiKeySecret}` },
      payload: {
        rows: [{ ticketId: 'REQ-API-1', product: 'VPC', scheduleAt: '2026-06-30', workflowStatus: '开发中' }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().inserted).toBe(1)
  })

  it('imports rows with x-api-key header', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/requirement-ticket-progress/import',
      headers: { 'x-api-key': apiKeySecret },
      payload: {
        rows: [{ ticketId: 'REQ-API-2', product: 'SLB', scheduleAt: '2026-07-01', workflowStatus: '联调中' }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().updated + res.json().inserted).toBeGreaterThan(0)
  })

  it('blocks api key from admin-only list endpoint', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/requirement-ticket-progress',
      headers: { authorization: `Bearer ${apiKeySecret}` },
    })
    expect(res.statusCode).toBe(403)
  })
})
