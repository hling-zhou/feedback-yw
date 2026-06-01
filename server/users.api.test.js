import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-users-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-users-api-xx'
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
/** @type {Record<string, string>} */
let tokens = {}

function authHeader(role) {
  return { authorization: `Bearer ${tokens[role]}` }
}

const describeUsers = sqliteAvailable ? describe : describe.skip

describeUsers('users API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()

    const { createUser } = await import('./users.js')
    const { signAccessToken } = await import('./auth.js')
    const { registerAuthHooks, requirePermission } = await import('./middleware.js')
    const { registerSchemaErrorHandler } = await import('./registerSchemaErrorHandler.js')
    const { listUsers, toPublicUser } = await import('./users.js')
    const { FASTIFY_SCHEMA_OPTIONS } = await import('./schemas/common.js')

    const admin = await createUser({
      username: 'users_admin',
      password: 'AdminPass12345!',
      team: '管理',
      role: 'admin',
    })
    const viewer = await createUser({
      username: 'users_viewer',
      password: 'ViewerPass12345!',
      team: '查看',
      role: 'viewer',
    })

    tokens = {
      admin: signAccessToken(admin, 0),
      viewer: signAccessToken(viewer, 0),
    }

    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerSchemaErrorHandler(app)
    registerAuthHooks(app)

    app.get(
      '/api/users',
      { preHandler: requirePermission('manageUsers') },
      async (request, reply) => {
        try {
          return { users: listUsers().map((row) => toPublicUser(row)) }
        } catch (err) {
          return reply.code(500).send({
            error: err instanceof Error ? err.message : '加载用户列表失败',
          })
        }
      },
    )

    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('admin can list users with byProduct-like public fields', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: authHeader('admin'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.users.length).toBeGreaterThanOrEqual(2)
    expect(body.users[0]).toMatchObject({
      username: expect.any(String),
      role: expect.any(String),
      passwordChangedAt: expect.any(String),
    })
  })

  it('viewer cannot list users', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/users',
      headers: authHeader('viewer'),
    })
    expect(res.statusCode).toBe(403)
  })
})
