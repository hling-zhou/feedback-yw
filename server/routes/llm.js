import { requirePermission } from '../middleware.js'
import {
  isLlmConfigured,
  normalizeLlmBaseUrl,
  resolveLlmApiKeyForRequest,
  resolveLlmBaseUrl,
  resolveLlmModel,
} from '../llmConfig.js'
import { forwardLlmChatCompletion } from '../llmProxy.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerLlmRoutes(app) {
  app.get('/api/llm/status', { preHandler: requirePermission('view') }, async () => {
    return {
      configured: isLlmConfigured(),
      /** 允许在请求体携带 apiKey（设置页保存，仅经已登录代理转发，不落库） */
      clientKeyAllowed: true,
      defaultBaseUrl: resolveLlmBaseUrl(),
      defaultModel: resolveLlmModel(),
    }
  })

  app.post('/api/llm/chat', { preHandler: requirePermission('view') }, async (request, reply) => {
    const body = /** @type {Record<string, unknown>} */ (request.body || {})

    let apiKey
    try {
      apiKey = resolveLlmApiKeyForRequest(body).apiKey
    } catch (err) {
      if (err && typeof err === 'object' && err.code === 'LLM_NOT_CONFIGURED') {
        reply.code(503).send({
          error: 'LLM 未配置',
          hint:
            '请在 API 环境变量设置 LLM_API_KEY，或在「设置」中填写 API Key（线上配置，仅存本浏览器）',
        })
        return
      }
      throw err
    }

    const baseUrl = normalizeLlmBaseUrl(
      typeof body.baseUrl === 'string' && body.baseUrl.trim()
        ? body.baseUrl
        : resolveLlmBaseUrl(),
    )
    const defaultModel = resolveLlmModel()
    const { baseUrl: _b, model: clientModel, apiKey: _k, ...chatBody } = body
    const model =
      (typeof clientModel === 'string' && clientModel.trim()) ||
      (typeof chatBody.model === 'string' && chatBody.model.trim()) ||
      defaultModel

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
      const hint =
        err && typeof err === 'object' && 'hint' in err && typeof err.hint === 'string'
          ? err.hint
          : undefined
      reply.code(status >= 400 && status < 600 ? status : 502).send({
        error: message,
        ...(hint ? { hint } : {}),
      })
    }
  })
}
