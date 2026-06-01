import { hasPermission } from '../src/domain/auth/permissions.js'
import { isPasswordExpired, PASSWORD_EXPIRED_CODE, PASSWORD_EXPIRED_MESSAGE } from '../src/domain/passwordExpiry.js'
import { findUserById, resolveSessionVersion, toPublicUser } from './users.js'
import { verifyAccessToken } from './auth.js'

/**
 * @param {import('fastify').FastifyRequest} request
 */
export function extractBearerToken(request) {
  const header = request.headers.authorization || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || ''
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAuthHooks(app) {
  app.decorateRequest('user', null)

  app.addHook('preHandler', async (request, reply) => {
    const path = request.url.split('?')[0]
    if (path === '/api/auth/login' || path === '/api/auth/change-password' || path === '/health') return

    if (!path.startsWith('/api/')) return

    const token = extractBearerToken(request)
    if (!token) {
      reply.code(401).send({ error: '未登录或令牌无效' })
      return
    }

    const claims = verifyAccessToken(token)
    if (!claims) {
      reply.code(401).send({ error: '登录已过期，请重新登录' })
      return
    }

    const row = findUserById(claims.id)
    if (!row || row.status !== 'active') {
      reply.code(401).send({ error: '用户不存在或已禁用' })
      return
    }

    const passwordChangedAt = row.password_changed_at || row.created_at
    if (isPasswordExpired(passwordChangedAt)) {
      reply.code(403).send({
        code: PASSWORD_EXPIRED_CODE,
        error: PASSWORD_EXPIRED_MESSAGE,
        username: row.username,
        passwordChangedAt,
      })
      return
    }

    if (claims.sessionVersion !== resolveSessionVersion(row)) {
      reply.code(401).send({ error: '登录已失效，请重新登录' })
      return
    }

    request.user = toPublicUser(row)
  })
}

/**
 * @param {import('../src/domain/auth/permissions.js').PermissionCode} permission
 */
export function requirePermission(permission) {
  /** @param {import('fastify').FastifyRequest} request */
  /** @param {import('fastify').FastifyReply} reply */
  return async (request, reply) => {
    const user = request.user
    if (!user) {
      return reply.code(401).send({ error: '未登录' })
    }
    if (!hasPermission(user.role, permission)) {
      return reply.code(403).send({ error: '无权限执行此操作' })
    }
  }
}

/** 仅管理员（用于 bootstrap 等高危操作） */
export function requireAdmin() {
  /** @param {import('fastify').FastifyRequest} request */
  /** @param {import('fastify').FastifyReply} reply */
  return async (request, reply) => {
    const user = request.user
    if (!user) {
      return reply.code(401).send({ error: '未登录' })
    }
    if (user.role !== 'admin') {
      return reply.code(403).send({ error: '仅管理员可执行此操作' })
    }
  }
}
