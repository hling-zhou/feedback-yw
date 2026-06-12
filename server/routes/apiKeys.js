import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { apiKeyRepository } from '../apiKeyRepository.js'
import { createApiKeyBodySchema, revokeApiKeyParamsSchema } from '../schemas/apiKeySchemas.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerApiKeyRoutes(app) {
  app.get(
    '/api/api-keys',
    {
      preHandler: requirePermission('manageRequirementSync'),
    },
    async () => {
      return { items: apiKeyRepository.listApiKeys() }
    },
  )

  app.post(
    '/api/api-keys',
    {
      preHandler: requirePermission('manageRequirementSync'),
      schema: { body: createApiKeyBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {{ name: string; scopes: import('../src/domain/apiKey.js').ApiKeyScope[]; expiresAt?: string }} */ (
        request.body
      )
      try {
        const created = apiKeyRepository.createApiKey({
          name: body.name,
          scopes: body.scopes,
          expiresAt: body.expiresAt,
          createdByUserId: request.user?.id ?? null,
          createdByUsername: request.user?.username ?? '',
        })
        logAuditFromRequest(request, 'api_key.create', {
          apiKeyId: created.apiKey.id,
          apiKeyName: created.apiKey.name,
          scopes: created.apiKey.scopes,
        })
        reply.code(201)
        return {
          apiKey: created.apiKey,
          secret: created.secret,
        }
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )

  app.post(
    '/api/api-keys/:id/revoke',
    {
      preHandler: requirePermission('manageRequirementSync'),
      schema: { params: revokeApiKeyParamsSchema },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        const apiKey = apiKeyRepository.revokeApiKey(id)
        logAuditFromRequest(request, 'api_key.revoke', {
          apiKeyId: apiKey.id,
          apiKeyName: apiKey.name,
        })
        return { ok: true, apiKey }
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )
}
