import { requireAdmin, requireAdminOrApiKeyScope, requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { requirementTicketProgressRepository } from '../requirementTicketProgressRepository.js'
import { resolveRequirementTicketDetails } from '../../src/domain/requirementTicketProgress.js'
import {
  requirementStatusMappingBodySchema,
  requirementTicketProgressImportBodySchema,
  requirementTicketProgressListQuerySchema,
  requirementTicketProgressLookupBodySchema,
} from '../schemas/requirementTicketProgressSchemas.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerRequirementTicketProgressRoutes(app) {
  app.get(
    '/api/requirement-ticket-progress',
    {
      preHandler: [requirePermission('view'), requireAdmin()],
      schema: { querystring: requirementTicketProgressListQuerySchema },
    },
    async (request) => {
      const query = /** @type {import('../requirementTicketProgressRepository.js').RequirementTicketProgressListQuery} */ (
        request.query
      )
      return requirementTicketProgressRepository.listProgress(query)
    },
  )

  app.post(
    '/api/requirement-ticket-progress/lookup',
    {
      preHandler: requirePermission('view'),
      schema: { body: requirementTicketProgressLookupBodySchema },
    },
    async (request) => {
      const body = /** @type {{ ticketIds: string[] }} */ (request.body)
      const ticketIds = body.ticketIds || []
      const progressById = requirementTicketProgressRepository.getProgressByTicketIds(ticketIds)
      const mappingByWorkflowStatus = requirementTicketProgressRepository.getStatusMappingMap()
      const tickets = resolveRequirementTicketDetails(ticketIds, progressById, mappingByWorkflowStatus)
      return { tickets }
    },
  )

  app.post(
    '/api/requirement-ticket-progress/import',
    {
      preHandler: [requireAdminOrApiKeyScope('requirement_ticket_progress:import')],
      schema: { body: requirementTicketProgressImportBodySchema },
    },
    async (request) => {
      const body = /** @type {{ rows: import('../requirementTicketProgressRepository.js').RequirementTicketProgressImportRow[] }} */ (
        request.body
      )
      const result = requirementTicketProgressRepository.importProgressRows(body.rows || [])
      logAuditFromRequest(request, 'requirement_ticket_progress.import', {
        inserted: result.inserted,
        updated: result.updated,
        errorCount: result.errors.length,
      })
      return { ok: true, ...result }
    },
  )

  app.get(
    '/api/requirement-status-mapping',
    {
      preHandler: [requirePermission('view'), requireAdmin()],
    },
    async () => {
      return { items: requirementTicketProgressRepository.listStatusMappings() }
    },
  )

  app.put(
    '/api/requirement-status-mapping',
    {
      preHandler: [requirePermission('view'), requireAdmin()],
      schema: { body: requirementStatusMappingBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {{ items: import('../src/domain/requirementTicketProgress.js').RequirementStatusMappingRow[] }} */ (
        request.body
      )
      const result = requirementTicketProgressRepository.replaceStatusMappings(body.items || [])
      if (!result.ok) {
        return reply.code(400).send({ ok: false, errors: result.errors, items: result.items })
      }
      logAuditFromRequest(request, 'requirement_status_mapping.replace', {
        count: result.items.length,
      })
      return { ok: true, items: result.items }
    },
  )
}
