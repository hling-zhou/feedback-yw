import {
  assertAdminSeedConfig,
  assertCorsConfig,
  assertJwtConfig,
  assertProductionConfig,
  getCorsRegisterOptions,
  resolveCorsOrigins,
} from './config.js'
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { hasPermission, ROLE_PERMISSIONS } from '../src/domain/auth/permissions.js'
import { getDb, closeDb } from './db.js'
import { registerAuthHooks, requirePermission } from './middleware.js'
import { signAccessToken } from './auth.js'

assertJwtConfig()
assertCorsConfig()
assertProductionConfig()
import {
  createUser,
  deleteUser,
  listUsers,
  seedAdminUser,
  toPublicUser,
  updateUser,
  verifyPassword,
} from './users.js'
import { registerStorageRoutes } from './routes/storage.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerLlmRoutes } from './routes/llm.js'
import { registerAuditRoutes } from './routes/audit.js'
import { buildHealthReport } from './health.js'
import { logAuditFromRequest } from './audit.js'

const PORT = Number(process.env.API_PORT || 3001)
const HOST = process.env.API_HOST || '127.0.0.1'
const API_BODY_LIMIT_BYTES = Number(process.env.API_BODY_LIMIT_BYTES) || 12 * 1024 * 1024

const app = Fastify({ logger: true, bodyLimit: API_BODY_LIMIT_BYTES })

await app.register(cors, getCorsRegisterOptions())
console.info(`[api] CORS allowed origins: ${resolveCorsOrigins().join(', ')}`)

registerAuthHooks(app)
registerStorageRoutes(app)
registerActionRoutes(app)
registerLlmRoutes(app)
registerAuditRoutes(app)

app.get('/health', async (_request, reply) => {
  const report = buildHealthReport()
  if (!report.dbOk) {
    reply.code(503)
  }
  return report
})

app.post('/api/auth/login', async (request, reply) => {
  const body = /** @type {{ username?: string; password?: string }} */ (request.body || {})
  const username = body.username?.trim()
  const password = body.password || ''
  if (!username || !password) {
    reply.code(400).send({ error: '请输入用户名和密码' })
    return
  }

  const user = await verifyPassword(username, password)
  if (!user) {
    reply.code(401).send({ error: '用户名或密码错误' })
    return
  }

  const accessToken = signAccessToken(user)
  return { user, accessToken }
})

app.get('/api/auth/me', async (request) => {
  return { user: request.user }
})

app.post('/api/auth/logout', async () => ({ ok: true }))

app.get(
  '/api/users',
  { preHandler: requirePermission('manageUsers') },
  async () => ({
    users: listUsers().map(toPublicUser),
  }),
)

app.post(
  '/api/users',
  { preHandler: requirePermission('manageUsers') },
  async (request, reply) => {
    const body = /** @type {{
      username?: string
      password?: string
      team?: string
      role?: 'admin' | 'editor' | 'viewer'
    }} */ (request.body || {})

    if (!body.username?.trim() || !body.password || !body.team?.trim() || !body.role) {
      reply.code(400).send({ error: '请填写用户名、密码、班组和角色' })
      return
    }
    if (!['admin', 'editor', 'viewer'].includes(body.role)) {
      reply.code(400).send({ error: '无效角色' })
      return
    }

    try {
      const user = await createUser({
        username: body.username,
        password: body.password,
        team: body.team,
        role: body.role,
      })
      reply.code(201)
      logAuditFromRequest(request, 'user.create', {
        userId: user.id,
        username: user.username,
        role: user.role,
      })
      return { user }
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  },
)

app.patch(
  '/api/users/:id',
  { preHandler: requirePermission('manageUsers') },
  async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params)
    const body = /** @type {{
      team?: string
      role?: 'admin' | 'editor' | 'viewer'
      status?: 'active' | 'disabled'
      password?: string
    }} */ (request.body || {})

    if (body.role && !['admin', 'editor', 'viewer'].includes(body.role)) {
      reply.code(400).send({ error: '无效角色' })
      return
    }
    if (body.status && !['active', 'disabled'].includes(body.status)) {
      reply.code(400).send({ error: '无效状态' })
      return
    }

    try {
      const user = await updateUser(id, body, request.user?.id)
      logAuditFromRequest(request, 'user.update', {
        userId: id,
        fields: Object.keys(body),
        role: body.role,
        status: body.status,
      })
      return { user }
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  },
)

app.delete(
  '/api/users/:id',
  { preHandler: requirePermission('manageUsers') },
  async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params)
    try {
      deleteUser(id, request.user?.id)
      logAuditFromRequest(request, 'user.delete', { userId: id })
      return { ok: true }
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  },
)

app.get('/api/auth/permissions', async (request) => {
  const role = request.user?.role
  return {
    role,
    permissions: role ? ROLE_PERMISSIONS[/** @type {keyof typeof ROLE_PERMISSIONS} */ (role)] || [] : [],
  }
})

getDb()
const existingUsers = listUsers()
assertAdminSeedConfig(existingUsers.length > 0)
await seedAdminUser()
if (listUsers().length === 0) {
  throw new Error('[auth] 未能创建初始管理员，请检查 ADMIN_INITIAL_PASSWORD 配置。')
}

try {
  await app.listen({ port: PORT, host: HOST })
  console.info(`[api] http://${HOST}:${PORT}`)
} catch (err) {
  app.log.error(err)
  process.exit(1)
}

process.on('SIGINT', () => {
  closeDb()
  process.exit(0)
})
