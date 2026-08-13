import { requirePermission } from '../middleware.js'
import { hasPermission } from '../../src/domain/auth/permissions.js'
import { pickPostUseJiraEditablePatch } from '../../src/domain/postUseJira.js'
import {
  postUseCallbackDecisionRepository,
  postUseJiraRepository,
} from '../postUseJiraRepository.js'

/** @param {import('fastify').FastifyRequest} request */
function assertEditRecordPermission(request, reply) {
  const user = request.user
  if (!user) {
    reply.code(401).send({ error: '未登录' })
    return false
  }
  if (!hasPermission(user.role, 'editRecord')) {
    reply.code(403).send({ error: '无权限执行此操作' })
    return false
  }
  return true
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerPostUseJiraRoutes(app) {
  app.get(
    '/api/post-use-callback-decisions',
    { preHandler: requirePermission('view') },
    async () => ({ items: postUseCallbackDecisionRepository.list() }),
  )

  app.put('/api/post-use-callback-decisions', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const body = /** @type {{ items?: Record<string, unknown>[] }} */ (request.body || {})
    const items = Array.isArray(body.items) ? body.items : []
    const saved = postUseCallbackDecisionRepository.upsertMany(items)
    return { items: saved }
  })

  app.get('/api/post-use-jira', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {Record<string, string>} */ (request.query || {})
    return postUseJiraRepository.list({
      importMonth: q.importMonth,
      productName: q.productName,
      status: q.status,
      search: q.search,
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    })
  })

  app.post('/api/post-use-jira', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const body = /** @type {{ items?: Record<string, unknown>[] }} */ (request.body || {})
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) {
      reply.code(400)
      return { error: '请至少提交一条待内部提单记录' }
    }
    const saved = postUseJiraRepository.archiveMany(items)
    return { items: saved }
  })

  app.patch('/api/post-use-jira/:id', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    const body = /** @type {Record<string, unknown>} */ (request.body || {})
    const patch = pickPostUseJiraEditablePatch(body)
    const item = postUseJiraRepository.patch(id, patch)
    if (!item) {
      reply.code(404)
      return { error: '记录不存在' }
    }
    return { item }
  })

  app.delete('/api/post-use-jira/:id', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    const ok = postUseJiraRepository.delete(id)
    if (!ok) {
      reply.code(404)
      return { error: '记录不存在' }
    }
    return { ok: true }
  })

  app.post('/api/post-use-jira/batch-delete', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const body = /** @type {{ ids?: string[] }} */ (request.body || {})
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id || '').trim()).filter(Boolean) : []
    if (!ids.length) {
      reply.code(400)
      return { error: '请选择要删除的记录' }
    }
    const deleted = postUseJiraRepository.deleteMany(ids)
    return { deleted }
  })
}
