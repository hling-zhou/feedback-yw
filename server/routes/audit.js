import { requireAdmin } from '../middleware.js'
import { listAuditLogs } from '../audit.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAuditRoutes(app) {
  app.get('/api/audit', { preHandler: requireAdmin() }, async (request, reply) => {
    const q = /** @type {{ days?: string }} */ (request.query || {})
    const days = q.days != null ? Number(q.days) : 7
    try {
      return { entries: listAuditLogs(days) }
    } catch (err) {
      request.log.error(err)
      return reply.code(500).send({
        error: err instanceof Error ? err.message : '加载审计日志失败',
      })
    }
  })
}
