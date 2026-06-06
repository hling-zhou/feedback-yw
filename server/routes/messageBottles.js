import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { messageBottleRepository } from '../messageBottleRepository.js'
import {
  createMessageBottleBodySchema,
  updateMessageBottleProgressBodySchema,
} from '../schemas/messageBottleSchemas.js'
import { uuidParamSchema } from '../schemas/common.js'
import { validateMessageBottleAttachments } from '../../src/domain/messageBottle.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerMessageBottleRoutes(app) {
  app.post(
    '/api/message-bottles',
    { schema: { body: createMessageBottleBodySchema } },
    async (request, reply) => {
      const user = request.user
      if (!user) {
        return reply.code(401).send({ error: '未登录' })
      }

      const body = /** @type {{ content: string; attachments?: import('../../src/domain/messageBottle.js').MessageBottleAttachment[] }} */ (
        request.body
      )
      const attachmentError = validateMessageBottleAttachments(body.attachments)
      if (attachmentError) {
        return reply.code(400).send({ error: attachmentError })
      }

      try {
        const item = messageBottleRepository.create({
          userId: user.id,
          username: user.username,
          content: body.content,
          attachments: body.attachments,
        })
        logAuditFromRequest(request, 'message_bottle.create', {
          messageBottleId: item.id,
          attachmentCount: item.attachments.length,
        })
        reply.code(201)
        return { item }
      } catch (err) {
        request.log.error(err)
        return reply.code(500).send({
          error: err instanceof Error ? err.message : '提交失败',
        })
      }
    },
  )

  app.get(
    '/api/message-bottles',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const q = /** @type {{ limit?: string; offset?: string }} */ (request.query || {})
      try {
        return messageBottleRepository.list({
          limit: q.limit != null ? Number(q.limit) : undefined,
          offset: q.offset != null ? Number(q.offset) : undefined,
        })
      } catch (err) {
        request.log.error(err)
        return reply.code(500).send({
          error: err instanceof Error ? err.message : '加载漂流瓶失败',
        })
      }
    },
  )

  app.patch(
    '/api/message-bottles/:id/progress',
    {
      preHandler: requirePermission('manageMessageBottles'),
      schema: { params: uuidParamSchema, body: updateMessageBottleProgressBodySchema },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const body = /** @type {{ progress: string }} */ (request.body)
      try {
        const item = messageBottleRepository.updateProgress(id, body.progress)
        if (!item) {
          return reply.code(404).send({ error: '漂流瓶不存在' })
        }
        logAuditFromRequest(request, 'message_bottle.progress_update', {
          messageBottleId: id,
          progress: item.progress,
        })
        return { item }
      } catch (err) {
        request.log.error(err)
        return reply.code(500).send({
          error: err instanceof Error ? err.message : '更新处理进展失败',
        })
      }
    },
  )
}
