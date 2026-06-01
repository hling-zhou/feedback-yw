import { formatSchemaValidationError } from './schemas/common.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerSchemaErrorHandler(app) {
  app.setErrorHandler((error, _request, reply) => {
    if (error.validation) {
      reply.code(400).send({ error: formatSchemaValidationError(error) })
      return
    }
    reply.send(error)
  })
}
