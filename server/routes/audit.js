import { requireAdmin } from '../middleware.js'
import { listAuditLogs } from '../audit.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAuditRoutes(app) {
  app.get('/api/audit', { preHandler: requireAdmin() }, async (request) => {
    const q = /** @type {{ days?: string }} */ (request.query || {})
    const days = q.days != null ? Number(q.days) : 7
    return { entries: listAuditLogs(days) }
  })
}
