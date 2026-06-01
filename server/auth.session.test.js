import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-auth-session-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-session-xx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

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

/** @type {import('fastify').FastifyInstance} */
let app
/** @type {string} */
let token

const describeSession = sqliteAvailable ? describe : describe.skip

describeSession('auth session revocation (P0)', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()

    const { registerAuthHooks } = await import('./middleware.js')
    const { registerSchemaErrorHandler } = await import('./registerSchemaErrorHandler.js')
    const { loginBodySchema } = await import('./schemas/authSchemas.js')
    const { signAccessToken } = await import('./auth.js')
    const { createUser, verifyPasswordCredentials } = await import('./users.js')

    const { FASTIFY_SCHEMA_OPTIONS } = await import('./schemas/common.js')
    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerSchemaErrorHandler(app)
    registerAuthHooks(app)

    app.post('/api/auth/login', { schema: { body: loginBodySchema } }, async (request, reply) => {
      const body = /** @type {{ username: string; password: string }} */ (request.body)
      const verified = await verifyPasswordCredentials(body.username, body.password)
      if (!verified) {
        reply.code(401).send({ error: '用户名或密码错误' })
        return
      }
      if (verified.user.passwordExpired) {
        reply.code(403).send({ code: 'PASSWORD_EXPIRED', error: '密码已过期' })
        return
      }
      return {
        accessToken: signAccessToken(verified.user, verified.sessionVersion),
        user: verified.user,
      }
    })

    app.get('/api/auth/me', async (request) => ({ user: request.user }))

    app.post('/api/auth/logout', async (request) => {
      const { invalidateUserSessions } = await import('./users.js')
      if (request.user?.id) invalidateUserSessions(request.user.id)
      return { ok: true }
    })

    await createUser({
      username: 'session_user',
      password: 'SessionPass123!',
      team: '测试',
      role: 'viewer',
    })

    await app.ready()

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: 'session_user', password: 'SessionPass123!' },
    })
    token = JSON.parse(loginRes.body).accessToken
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('authenticated request succeeds before logout', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).user.username).toBe('session_user')
  })

  it('logout revokes token for subsequent requests', async () => {
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(logoutRes.statusCode).toBe(200)

    const afterRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(afterRes.statusCode).toBe(401)
    expect(JSON.parse(afterRes.body).error).toMatch(/登录已失效|令牌无效/)
  })

  it('rejects login body with unknown fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: 'session_user', password: 'SessionPass123!', evil: true },
    })
    expect(res.statusCode).toBe(400)
  })
})
