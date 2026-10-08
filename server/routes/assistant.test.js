import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-assistant-route-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-assistant-route-xx'
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

const describeRoute = sqliteAvailable ? describe : describe.skip

describeRoute('assistant route permissions', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app
  /** @type {Record<string, string>} */
  let tokens = {}

  function authHeader(role) {
    return { authorization: `Bearer ${tokens[role]}` }
  }

  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const viewer = await createUser({
      username: 'asst_viewer',
      password: 'ViewerPass12345!',
      team: '产品运营组',
      role: 'viewer',
    })
    const admin = await createUser({
      username: 'asst_admin',
      password: 'AdminPass12345!',
      team: '产品运营组',
      role: 'admin',
    })
    tokens = { viewer: signAccessToken(viewer), admin: signAccessToken(admin) }

    const { apiKeyRepository } = await import('../apiKeyRepository.js')
    const createdKey = apiKeyRepository.createApiKey({
      name: 'assistant-test-key',
      scopes: ['requirement_ticket_progress:import'],
      createdByUsername: 'asst_admin',
    })
    tokens.apiKey = createdKey.secret

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerAssistantRoutes } = await import('./assistant.js')
    app = Fastify()
    registerAuthHooks(app)
    registerAssistantRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects API Key with 403', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/assistant/threads',
      headers: { authorization: `Bearer ${tokens.apiKey}` },
    })
    expect(res.statusCode).toBe(403)
  })

  it('rejects unauthenticated requests with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/assistant/threads' })
    expect(res.statusCode).toBe(401)
  })

  it('allows viewer to list threads', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/assistant/threads',
      headers: authHeader('viewer'),
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).threads).toEqual([])
  })

  it('viewer can create and delete own thread', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/assistant/threads',
      headers: authHeader('viewer'),
      payload: { title: '测试对话' },
    })
    expect(created.statusCode).toBe(200)
    const thread = JSON.parse(created.body).thread
    expect(thread.id).toBeTruthy()

    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/assistant/threads/${thread.id}`,
      headers: authHeader('viewer'),
    })
    expect(deleted.statusCode).toBe(200)
  })

  it('returns 503 when LLM not configured (even for nonexistent thread)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/assistant/chat',
      headers: authHeader('viewer'),
      payload: { threadId: 'no-such-thread', question: '测试' },
    })
    // LLM 配置检查在线程归属校验之前，未配置时统一返回 503
    expect(res.statusCode).toBe(503)
  })
})
