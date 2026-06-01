import { formatSchemaValidationError } from './schemas/common.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerSchemaErrorHandler(app) {
  app.setErrorHandler((error, request, reply) => {
    if (error.validation) {
      reply.code(400).send({ error: formatSchemaValidationError(error) })
      return
    }
    request.log.error(error)
    const statusCode =
      typeof error.statusCode === 'number' && error.statusCode >= 400 && error.statusCode < 600
        ? error.statusCode
        : 500
    reply.code(statusCode).send({
      error: error instanceof Error ? error.message : '服务器内部错误',
    })
  })
}
