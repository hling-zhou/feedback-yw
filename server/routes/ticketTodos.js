import { requirePermission } from '../middleware.js'
import { ticketTodoRepository } from '../ticketTodoRepository.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerTicketTodoRoutes(app) {
  app.get('/api/ticket-todos', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {import('../ticketTodoRepository.js').TicketTodoListQuery} */ (
      request.query || {}
    )
    return ticketTodoRepository.listTicketTodos(q)
  })

  app.get('/api/ticket-todos/stats', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {import('../ticketTodoRepository.js').TicketTodoListQuery} */ (
      request.query || {}
    )
    return ticketTodoRepository.getTicketTodoStats(q)
  })
}
