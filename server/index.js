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
import compress from '@fastify/compress'
import { ROLE_PERMISSIONS } from '../src/domain/auth/permissions.js'
import { getDb, closeDb } from './db.js'
import { registerAuthHooks, requirePermission } from './middleware.js'
import { registerSchemaErrorHandler } from './registerSchemaErrorHandler.js'
import { loginBodySchema, changePasswordBodySchema } from './schemas/authSchemas.js'
import { FASTIFY_SCHEMA_OPTIONS } from './schemas/common.js'
import {
  createUserBodySchema,
  updateUserBodySchema,
  updateUserParamsSchema,
  batchCreateUsersBodySchema,
} from './schemas/userSchemas.js'

assertJwtConfig()
assertCorsConfig()
assertProductionConfig()
import {
  createUser,
  changePasswordWithVerification,
  batchCreateUsers,
  deleteUser,
  listUsers,
  seedAdminUser,
  toPublicUser,
  updateUser,
  invalidateUserSessions,
} from './users.js'
import { registerLoginRateLimitCleanup } from './loginRateLimit.js'
import { handlePasswordLogin } from './authLogin.js'
import { registerStorageRoutes } from './routes/storage.js'
import { registerActionRoutes } from './routes/actions.js'
import { registerLlmRoutes } from './routes/llm.js'
import { registerAuditRoutes } from './routes/audit.js'
import { registerMessageBottleRoutes } from './routes/messageBottles.js'
import { registerTicketReviewRoutes } from './routes/ticketReviews.js'
import { registerComplaintCauseReviewRoutes } from './routes/complaintCauseReview.js'
import { registerRequirementTicketProgressRoutes } from './routes/requirementTicketProgress.js'
import { registerApiKeyRoutes } from './routes/apiKeys.js'
import { registerPostUseJiraRoutes } from './routes/postUseJira.js'
import { registerTicketTodoRoutes } from './routes/ticketTodos.js'
import { buildHealthReport } from './health.js'
import { logAuditFromRequest, logAudit } from './audit.js'

const PORT = Number(process.env.API_PORT || 3001)
const HOST = process.env.API_HOST || '127.0.0.1'
const API_BODY_LIMIT_BYTES = Number(process.env.API_BODY_LIMIT_BYTES) || 12 * 1024 * 1024

const app = Fastify({
  logger: true,
  bodyLimit: API_BODY_LIMIT_BYTES,
  ...FASTIFY_SCHEMA_OPTIONS,
})

registerSchemaErrorHandler(app)
registerLoginRateLimitCleanup(app)

await app.register(cors, getCorsRegisterOptions())
console.info(`[api] CORS allowed origins: ${resolveCorsOrigins().join(', ')}`)

// 记录 payload 为大文本 JSON，br/gzip 可压缩 5-10 倍，显著降低首屏传输量
await app.register(compress)

registerAuthHooks(app)
registerStorageRoutes(app)
registerActionRoutes(app)
registerLlmRoutes(app)
registerAuditRoutes(app)
registerMessageBottleRoutes(app)
registerTicketReviewRoutes(app)
registerComplaintCauseReviewRoutes(app)
registerRequirementTicketProgressRoutes(app)
registerApiKeyRoutes(app)
registerPostUseJiraRoutes(app)
registerTicketTodoRoutes(app)

app.get('/health', async (_request, reply) => {
  const report = buildHealthReport()
  if (!report.dbOk) {
    reply.code(503)
  }
  return report
})

app.post('/api/auth/login', { schema: { body: loginBodySchema } }, handlePasswordLogin)

app.post(
  '/api/auth/change-password',
  { schema: { body: changePasswordBodySchema } },
  async (request, reply) => {
  const body = /** @type {{ username: string; currentPassword: string; newPassword: string }} */ (
    request.body
  )
  try {
    const { user, wasExpired } = await changePasswordWithVerification({
      username: body.username,
      currentPassword: body.currentPassword,
      newPassword: body.newPassword,
    })
    logAudit({
      userId: user.id,
      username: user.username,
      action: 'auth.password_changed',
      detail: { reason: wasExpired ? 'expired_rotation' : 'voluntary' },
    })
    return { ok: true, user }
  } catch (err) {
    reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
  }
  },
)

app.get('/api/auth/me', async (request) => {
  return { user: request.user }
})

app.get('/api/users/assignees', async (request, reply) => {
  if (!request.user?.id) {
    reply.code(401).send({ error: '未登录' })
    return
  }
  return {
    users: listUsers()
      .filter((row) => row.status === 'active')
      .map((row) => ({
        id: row.id,
        username: row.username,
        team: row.team,
      })),
  }
})

app.post('/api/auth/logout', async (request) => {
  if (request.user?.id) {
    invalidateUserSessions(request.user.id)
    logAuditFromRequest(request, 'auth.logout', { userId: request.user.id })
  }
  return { ok: true }
})

app.get(
  '/api/users',
  { preHandler: requirePermission('manageUsers') },
  async (request, reply) => {
    try {
      return { users: listUsers().map((row) => toPublicUser(row)) }
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({
        error: err instanceof Error ? err.message : '加载用户列表失败',
      })
    }
  },
)

app.post(
  '/api/users',
  {
    preHandler: requirePermission('manageUsers'),
    schema: { body: createUserBodySchema },
  },
  async (request, reply) => {
    const body = /** @type {{
      username: string
      password: string
      team: string
      role: 'admin' | 'editor' | 'partial_editor' | 'viewer'
    }} */ (request.body)

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

app.post(
  '/api/users/batch',
  {
    preHandler: requirePermission('manageUsers'),
    schema: { body: batchCreateUsersBodySchema },
  },
  async (request, reply) => {
    const body = /** @type {{
      users: {
        username: string
        password: string
        team: string
        role: 'admin' | 'editor' | 'partial_editor' | 'viewer'
      }[]
    }} */ (request.body)

    try {
      const result = await batchCreateUsers(body.users)
      for (const user of result.created) {
        logAuditFromRequest(request, 'user.create', {
          userId: user.id,
          username: user.username,
          role: user.role,
          source: 'batch_import',
        })
      }
      reply.code(result.created.length ? 201 : 400)
      return result
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  },
)

app.patch(
  '/api/users/:id',
  {
    preHandler: requirePermission('manageUsers'),
    schema: { params: updateUserParamsSchema, body: updateUserBodySchema },
  },
  async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params)
    const body = /** @type {{
      team?: string
      role?: 'admin' | 'editor' | 'partial_editor' | 'viewer'
      status?: 'active' | 'disabled'
      password?: string
    }} */ (request.body)

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
  {
    preHandler: requirePermission('manageUsers'),
    schema: { params: updateUserParamsSchema },
  },
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
