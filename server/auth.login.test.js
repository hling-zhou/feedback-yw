import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import {
  PASSWORD_EXPIRED_CODE,
  PASSWORD_MAX_AGE_DAYS,
} from '../src/domain/passwordExpiry.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-auth-login-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-auth-login-xx'
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

const describeAuth = sqliteAvailable ? describe : describe.skip

describeAuth('auth login password expiry', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()

    const { registerAuthHooks } = await import('./middleware.js')
    const { createUser, setPasswordChangedAt } = await import('./users.js')

    app = Fastify({ logger: false })
    registerAuthHooks(app)

    app.post('/api/auth/login', async (request, reply) => {
      const { verifyPasswordCredentials } = await import('./users.js')
      const {
        PASSWORD_EXPIRED_CODE: CODE,
        PASSWORD_EXPIRED_MESSAGE: MSG,
      } = await import('../src/domain/passwordExpiry.js')

      const body = /** @type {{ username?: string; password?: string }} */ (request.body || {})
      const username = body.username?.trim()
      const password = body.password || ''
      if (!username || !password) {
        reply.code(400).send({ error: '请输入用户名和密码' })
        return
      }

      const verified = await verifyPasswordCredentials(username, password)
      if (!verified) {
        reply.code(401).send({ error: '用户名或密码错误' })
        return
      }

      if (verified.user.passwordExpired) {
        reply.code(403).send({
          code: CODE,
          error: MSG,
          username: verified.user.username,
          passwordChangedAt: verified.row.password_changed_at || verified.row.created_at,
        })
        return
      }

      const { signAccessToken } = await import('./auth.js')
      return { user: verified.user, accessToken: signAccessToken(verified.user, verified.sessionVersion) }
    })

    app.post('/api/auth/change-password', async (request, reply) => {
      const { changePasswordWithVerification } = await import('./users.js')
      const body = /** @type {{ username?: string; currentPassword?: string; newPassword?: string }} */ (
        request.body || {}
      )
      try {
        const { user } = await changePasswordWithVerification(body)
        return { ok: true, user }
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
      }
    })

    await createUser({
      username: 'expiry_user',
      password: 'OldPass123!',
      team: '测试',
      role: 'viewer',
    })

    const row = (await import('./users.js')).findUserByUsername('expiry_user')
    if (row) {
      const expiredAt = new Date(Date.now() - (PASSWORD_MAX_AGE_DAYS + 1) * 24 * 60 * 60 * 1000)
      setPasswordChangedAt(row.id, expiredAt.toISOString())
    }

    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('rejects login when password is older than 90 days', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: 'expiry_user', password: 'OldPass123!' },
    })
    expect(res.statusCode).toBe(403)
    const body = JSON.parse(res.body)
    expect(body.code).toBe(PASSWORD_EXPIRED_CODE)
    expect(body.username).toBe('expiry_user')
  })

  it('allows change-password when expired, then login succeeds', async () => {
    const changeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { 'content-type': 'application/json' },
      payload: {
        username: 'expiry_user',
        currentPassword: 'OldPass123!',
        newPassword: 'NewPass456!',
      },
    })
    expect(changeRes.statusCode).toBe(200)
    const changed = JSON.parse(changeRes.body)
    expect(changed.user.passwordExpired).toBe(false)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: 'expiry_user', password: 'NewPass456!' },
    })
    expect(loginRes.statusCode).toBe(200)
    expect(JSON.parse(loginRes.body).accessToken).toBeTruthy()
  })

  it('rejects unknown username with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'no_such_user', password: 'x' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('rejects wrong password with 401', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { username: 'expiry_user', password: 'WrongPass!' },
    })
    expect(res.statusCode).toBe(401)
  })

  it('allows voluntary change-password when password is not expired', async () => {
    const { createUser } = await import('./users.js')
    await createUser({
      username: 'active_user',
      password: 'ActivePass123!',
      team: '测试',
      role: 'viewer',
    })

    const changeRes = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { 'content-type': 'application/json' },
      payload: {
        username: 'active_user',
        currentPassword: 'ActivePass123!',
        newPassword: 'ActivePass456!',
      },
    })
    expect(changeRes.statusCode).toBe(200)

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: 'active_user', password: 'ActivePass456!' },
    })
    expect(loginRes.statusCode).toBe(200)
  })

  it('rejects change-password when new password equals current password', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/change-password',
      headers: { 'content-type': 'application/json' },
      payload: {
        username: 'expiry_user',
        currentPassword: 'NewPass456!',
        newPassword: 'NewPass456!',
      },
    })
    expect(res.statusCode).toBe(400)
    expect(JSON.parse(res.body).error).toMatch(/不能与当前密码相同/)
  })
})
