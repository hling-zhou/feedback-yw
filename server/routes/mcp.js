import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { storageRepository } from '../storageRepository.js'
import { verifyPasswordCredentials } from '../users.js'
import { resolveClientIp } from '../loginRateLimit.js'
import { API_KEY_PREFIX } from '../../src/domain/apiKey.js'

const META_KEY_MCP_SHARED_KEYS = 'mcp_shared_keys'

/** @type {Map<string, { count: number; resetAt: number }>} */
const revealAttempts = new Map()
const REVEAL_MAX_ATTEMPTS = 5
const REVEAL_WINDOW_MS = 5 * 60 * 1000

/**
 * @param {import('fastify').FastifyRequest} request
 * @returns {{ blocked: boolean; retryAfterSec?: number }}
 */
function checkRevealRateLimit(request) {
  const ip = resolveClientIp(request)
  const now = Date.now()
  const entry = revealAttempts.get(ip)
  if (!entry || now >= entry.resetAt) {
    return { blocked: false }
  }
  if (entry.count < REVEAL_MAX_ATTEMPTS) {
    return { blocked: false }
  }
  return {
    blocked: true,
    retryAfterSec: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
  }
}

/**
 * @param {import('fastify').FastifyRequest} request
 */
function recordRevealFailure(request) {
  const ip = resolveClientIp(request)
  const now = Date.now()
  const entry = revealAttempts.get(ip)
  if (!entry || now >= entry.resetAt) {
    revealAttempts.set(ip, { count: 1, resetAt: now + REVEAL_WINDOW_MS })
    return
  }
  entry.count += 1
}

/**
 * @param {import('fastify').FastifyRequest} request
 */
function clearRevealFailures(request) {
  const ip = resolveClientIp(request)
  revealAttempts.delete(ip)
}

/**
 * @typedef {{ read: string; full: string } | null} McpSharedKeys
 */

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerMcpRoutes(app) {
  // GET /api/mcp/shared-keys — 返回密钥前缀（密文展示）
  // 所有登录用户可访问（viewer 也可）
  app.get(
    '/api/mcp/shared-keys',
    {
      preHandler: requirePermission('view'),
    },
    async () => {
      const keys = /** @type {McpSharedKeys} */ (
        storageRepository.getMeta(META_KEY_MCP_SHARED_KEYS)
      )
      if (!keys) {
        return { keys: null }
      }
      return {
        keys: {
          read: maskKey(keys.read),
          full: maskKey(keys.full),
        },
      }
    },
  )

  // POST /api/mcp/reveal-key — 验证登录密码后返回明文密钥
  // 所有登录用户可用，但需要二次密码验证
  app.post(
    '/api/mcp/reveal-key',
    {
      preHandler: requirePermission('view'),
    },
    async (request, reply) => {
      const body = /** @type {{ password: string; scope: 'read' | 'full' }} */ (
        request.body
      )

      if (!body?.password || !body?.scope) {
        return reply.code(400).send({ error: '请输入密码并选择密钥类型' })
      }

      if (body.scope !== 'read' && body.scope !== 'full') {
        return reply.code(400).send({ error: '密钥类型无效' })
      }

      // 频率限制：防止已登录用户暴力尝试密码
      const rate = checkRevealRateLimit(request)
      if (rate.blocked) {
        return reply.code(429).send({
          error: `尝试次数过多，请 ${rate.retryAfterSec} 秒后再试`,
        })
      }

      // 验证登录密码
      const user = request.user
      if (!user?.username) {
        return reply.code(401).send({ error: '用户信息缺失' })
      }

      const verified = await verifyPasswordCredentials(user.username, body.password)
      if (!verified) {
        recordRevealFailure(request)
        logAuditFromRequest(request, 'mcp.key_reveal_failed', {
          scope: body.scope,
          username: user.username,
        })
        return reply.code(403).send({ error: '密码验证失败' })
      }

      clearRevealFailures(request)

      const keys = /** @type {McpSharedKeys} */ (
        storageRepository.getMeta(META_KEY_MCP_SHARED_KEYS)
      )
      if (!keys || !keys[body.scope]) {
        return reply.code(404).send({ error: '该类型密钥尚未配置，请联系管理员' })
      }

      logAuditFromRequest(request, 'mcp.key_reveal', {
        scope: body.scope,
        username: user.username,
      })

      return { secret: keys[body.scope] }
    },
  )

  // PUT /api/mcp/shared-keys — 管理员设置/更换共享密钥
  app.put(
    '/api/mcp/shared-keys',
    {
      preHandler: requirePermission('manageRequirementSync'),
    },
    async (request, reply) => {
      const body = /** @type {{ read?: string; full?: string }} */ (request.body)

      if (!body?.read && !body?.full) {
        return reply.code(400).send({ error: '请至少提供一个密钥值' })
      }

      // 验证密钥格式（必须以 fi_live_ 开头，长度 >= 20）
      const validateKey = (key) => {
        if (!key) return true // 空值跳过（不更新该字段）
        const trimmed = key.trim()
        if (!trimmed.startsWith(API_KEY_PREFIX)) {
          return `密钥必须以 ${API_KEY_PREFIX} 开头`
        }
        if (trimmed.length < 20) {
          return '密钥长度不足'
        }
        return null
      }

      if (body.read) {
        const err = validateKey(body.read)
        if (err) return reply.code(400).send({ error: `脱敏模式密钥：${err}` })
      }
      if (body.full) {
        const err = validateKey(body.full)
        if (err) return reply.code(400).send({ error: `完整模式密钥：${err}` })
      }

      const existing = /** @type {McpSharedKeys} */ (
        storageRepository.getMeta(META_KEY_MCP_SHARED_KEYS)
      ) || { read: '', full: '' }

      const updated = {
        read: body.read?.trim() || existing.read || '',
        full: body.full?.trim() || existing.full || '',
      }

      storageRepository.putMeta(META_KEY_MCP_SHARED_KEYS, updated)

      logAuditFromRequest(request, 'mcp.key_update', {
        updatedRead: !!body.read,
        updatedFull: !!body.full,
      })

      return {
        keys: {
          read: maskKey(updated.read),
          full: maskKey(updated.full),
        },
      }
    },
  )
}

/**
 * @param {string} key
 * @returns {string}
 */
function maskKey(key) {
  if (!key) return ''
  if (key.length <= 12) return key.slice(0, 8) + '••••'
  return key.slice(0, 12) + '••••••••'
}
