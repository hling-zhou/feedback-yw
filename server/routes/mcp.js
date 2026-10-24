import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { storageRepository } from '../storageRepository.js'
import { verifyPasswordCredentials } from '../users.js'

const META_KEY_MCP_SHARED_KEYS = 'mcp_shared_keys'

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

      // 验证登录密码
      const user = request.user
      if (!user?.username) {
        return reply.code(401).send({ error: '用户信息缺失' })
      }

      const verified = await verifyPasswordCredentials(user.username, body.password)
      if (!verified) {
        return reply.code(403).send({ error: '密码验证失败' })
      }

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
