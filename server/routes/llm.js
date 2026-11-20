import { llmChatBodySchema } from '../schemas/llmSchemas.js'
import { requirePermission } from '../middleware.js'
import {
  getLlmConfigStatus,
  normalizeLlmBaseUrl,
  resolveLlmApiKey,
  resolveLlmBaseUrl,
  resolveLlmModel,
  resolveReportLlmModel,
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
      reportModel: status.reportModel || status.model,
    }
  })

  /**
   * 团队大模型配置：返回脱敏后的 apiKey，用于设置页表单回显。
   * 所有人可读（含 apiKeyMasked 掩码），写入仅管理员。
   */
  app.get('/api/llm/config', { preHandler: requirePermission('view') }, async () => {
    const status = getLlmConfigStatus()
    return {
      source: status.source,
      apiKeyMasked: status.apiKeyMasked,
      apiKeyConfigured: status.configured,
      baseUrl: status.baseUrl,
      model: status.model,
      reportModel: status.reportModel,
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
    const { baseUrl: _b, model: _m, apiKey: _k, purpose, ...chatBody } = body
    const model = purpose === 'report' ? resolveReportLlmModel() : resolveLlmModel()

    // 11-20 拍板加闸（用户裁定范围）：仅报告 narrative 链（purpose='report'，36k 预算
    // 阶梯续跑）加 300s 超时——真机实证半开连接挂死场景即此链（前端无尽转圈）。
    // 超时走既有失败回退链（文案批失败不阻塞、待办 fallbackContent、归类回退原文自成一档）。
    // 打标链路（未传 purpose 的一切调用）不加：数据量每次不定、大批量耗时长不可预测，
    // 固定超时会误杀；该链自带批次切分与失败重试，维持无限等待（用户拍板）。
    const timeoutMs = purpose === 'report' ? 300_000 : undefined
    try {
      return await forwardLlmChatCompletion({
        baseUrl,
        apiKey,
        body: { ...chatBody, model },
        timeoutMs,
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
