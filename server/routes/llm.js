import { llmChatBodySchema } from '../schemas/llmSchemas.js'
import { requirePermission } from '../middleware.js'
import {
  getLlmConfigStatus,
  normalizeLlmBaseUrl,
  resolveLlmApiKey,
  resolveLlmBaseUrl,
  resolveLlmModel,
} from '../llmConfig.js'
import { forwardLlmChatCompletion } from '../llmProxy.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerLlmRoutes(app) {
  app.get('/api/llm/status', { preHandler: requirePermission('view') }, async () => {
    const status = getLlmConfigStatus()
    return {
      configured: status.configured,
      source: status.source,
      defaultBaseUrl: status.baseUrl,
      defaultModel: status.model,
    }
  })

  /**
   * 团队大模型配置（仅管理员）：返回脱敏后的 apiKey，用于设置页表单回显。
   */
  app.get('/api/llm/config', { preHandler: requirePermission('manageLlmConfig') }, async () => {
    const status = getLlmConfigStatus()
    return {
      source: status.source,
      apiKeyMasked: status.apiKeyMasked,
      apiKeyConfigured: status.configured,
      baseUrl: status.baseUrl,
      model: status.model,
    }
  })

  app.post('/api/llm/chat', {
    preHandler: requirePermission('view'),
    schema: { body: llmChatBodySchema },
  }, async (request, reply) => {
    const body = /** @type {Record<string, unknown>} */ (request.body)

    let apiKey
    try {
      apiKey = resolveLlmApiKey()
    } catch {
      reply.code(503).send({
        error: 'LLM 未配置',
        hint: '请由管理员在「设置」中配置大模型，或在服务端配置 LLM_API_KEY 环境变量。',
      })
      return
    }

    // baseUrl / model 一律由服务端解析（库 ＞ 环境变量），不接受请求体覆盖，
    // 避免个人设置绕过团队配置。
    const baseUrl = resolveLlmBaseUrl()
    const defaultModel = resolveLlmModel()
    const { baseUrl: _b, model: _m, apiKey: _k, ...chatBody } = body
    const model =
      (typeof chatBody.model === 'string' && chatBody.model.trim()) || defaultModel

    try {
      return await forwardLlmChatCompletion({
        baseUrl,
        apiKey,
        body: { ...chatBody, model },
      })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      const status =
        err && typeof err === 'object' && 'statusCode' in err && Number.isFinite(err.statusCode)
          ? err.statusCode
          : 502
      const hint = err && typeof err === 'object' && 'hint' in err && typeof err.hint === 'string'
        ? err.hint
        : undefined
      reply.code(status >= 400 && status < 600 ? status : 502).send({
        error: message,
        ...(hint ? { hint } : {}),
      })
    }
  })
}
