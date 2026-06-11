import { requirePermission } from '../middleware.js'
import { userTicketReviewRepository } from '../userTicketReviewRepository.js'
import {
  putTicketReviewBodySchema,
  ticketReviewRecordIdParamsSchema,
} from '../schemas/ticketReviewSchemas.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerTicketReviewRoutes(app) {
  app.get(
    '/api/reviews/tickets',
    { preHandler: requirePermission('view') },
    async (request) => {
      const user = request.user
      const items = userTicketReviewRepository.listByUserId(user.id).map((row) => ({
        recordId: row.recordId,
        source: row.source,
        markedAt: row.markedAt,
      }))
      return { items }
    },
  )

  app.put(
    '/api/reviews/tickets/:recordId',
    {
      preHandler: requirePermission('view'),
      schema: {
        params: ticketReviewRecordIdParamsSchema,
        body: putTicketReviewBodySchema,
      },
    },
    async (request) => {
      const user = request.user
      const { recordId } = /** @type {{ recordId: string }} */ (request.params)
      const body = /** @type {{ source: 'manual' | 'save' }} */ (request.body)
      const item = userTicketReviewRepository.markDone(user.id, recordId, body.source)
      return {
        ok: true,
        item: {
          recordId: item.recordId,
          source: item.source,
          markedAt: item.markedAt,
        },
      }
    },
  )

  app.delete(
    '/api/reviews/tickets/:recordId',
    {
      preHandler: requirePermission('view'),
      schema: { params: ticketReviewRecordIdParamsSchema },
    },
    async (request) => {
      const user = request.user
      const { recordId } = /** @type {{ recordId: string }} */ (request.params)
      userTicketReviewRepository.unmark(user.id, recordId)
      return { ok: true }
    },
  )
}
