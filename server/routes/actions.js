import { hasPermission } from '../../src/domain/auth/permissions.js'
import {
  isActionItemStatus,
  mergeActionItemPatch,
  validateActionItemCreate,
} from '../../src/domain/actionItem.js'
import {
  createActionBodySchema,
  patchActionBodySchema,
  unlinkTicketsBodySchema,
  actionIdParamsSchema,
} from '../schemas/actionSchemas.js'
import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { actionItemRepository } from '../actionItemRepository.js'

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
export function registerActionRoutes(app) {
  app.get('/api/actions', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {import('../actionItemRepository.js').ActionItemListQuery} */ (
      request.query || {}
    )
    return actionItemRepository.listActionItems(q)
  })

  app.get('/api/actions/stats', { preHandler: requirePermission('view') }, async () => {
    return { counts: actionItemRepository.countActionItemsByStatus() }
  })

  app.get('/api/actions/:id', { preHandler: requirePermission('view') }, async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params)
    const item = actionItemRepository.getActionItem(id)
    if (!item) {
      reply.code(404).send({ error: '举措不存在' })
      return
    }
    return { item }
  })

  app.post('/api/actions', { schema: { body: createActionBodySchema } }, async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return

    const body = /** @type {Partial<import('../../src/domain/actionItem.js').ActionItem>} */ (
      request.body || {}
    )
    const validated = validateActionItemCreate(body)
    if (!validated.ok) {
      reply.code(400).send({ error: validated.error })
      return
    }

    actionItemRepository.putActionItem(validated.item)
    logAuditFromRequest(request, 'action.create', { actionId: validated.item.id })
    reply.code(201)
    return { item: actionItemRepository.getActionItem(validated.item.id) }
  })

  app.patch(
    '/api/actions/:id',
    { schema: { params: actionIdParamsSchema, body: patchActionBodySchema } },
    async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return

    const { id } = /** @type {{ id: string }} */ (request.params)
    const existing = actionItemRepository.getActionItem(id)
    if (!existing) {
      reply.code(404).send({ error: '举措不存在' })
      return
    }

    const body = /** @type {Partial<import('../../src/domain/actionItem.js').ActionItem>} */ (
      request.body || {}
    )
    if (body.status != null && !isActionItemStatus(body.status)) {
      reply.code(400).send({ error: '无效的举措状态' })
      return
    }

    const merged = mergeActionItemPatch(existing, body)
    if (!merged.ok) {
      reply.code(400).send({ error: merged.error })
      return
    }

    actionItemRepository.putActionItem(merged.item)
    logAuditFromRequest(request, 'action.update', { actionId: id, fields: Object.keys(body) })
    return { item: actionItemRepository.getActionItem(id) }
    },
  )

  app.post(
    '/api/actions/unlink-tickets',
    { schema: { body: unlinkTicketsBodySchema } },
    async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return

    const body = /** @type {{ links: { actionId: string; ticketId: string }[] }} */ (request.body)
    const result = actionItemRepository.unlinkTicketsFromActionItems(body.links)
    logAuditFromRequest(request, 'action.unlink_tickets', { count: result.updated })
    return result
    },
  )

  app.delete(
    '/api/actions/:id',
    { schema: { params: actionIdParamsSchema } },
    async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return

    const { id } = /** @type {{ id: string }} */ (request.params)
    const deleted = actionItemRepository.deleteActionItem(id)
    if (!deleted) {
      reply.code(404).send({ error: '举措不存在' })
      return
    }
    logAuditFromRequest(request, 'action.delete', { actionId: id })
    return { ok: true }
  })
}
