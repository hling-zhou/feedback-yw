import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { assistantThreadRepository } from '../assistantThreadRepository.js'
import { runAssistantLoop } from '../assistantLlmLoop.js'
import {
  checkRateLimit,
  acquireThread,
  releaseThread,
} from '../assistantRateLimit.js'
import {
  assistantChatBodySchema,
  assistantThreadCreateBodySchema,
} from '../schemas/assistantSchemas.js'
import { isLlmConfigured } from '../llmConfig.js'
import { storageRepository } from '../storageRepository.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerAssistantRoutes(app) {
  app.get(
    '/api/assistant/threads',
    { preHandler: requirePermission('view') },
    async (request) => {
      const userId = request.user?.id || ''
      return { threads: assistantThreadRepository.listThreads(userId) }
    },
  )

  app.post(
    '/api/assistant/threads',
    {
      preHandler: requirePermission('view'),
      schema: { body: assistantThreadCreateBodySchema },
    },
    async (request) => {
      const userId = request.user?.id || ''
      const body = /** @type {{ title?: string }} */ (request.body || {})
      const thread = assistantThreadRepository.createThread(userId, body.title)
      return { thread }
    },
  )

  app.get(
    '/api/assistant/threads/:id/messages',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const userId = request.user?.id || ''
      const { id } = /** @type {{ id: string }} */ (request.params)
      const thread = assistantThreadRepository.getThread(userId, id)
      if (!thread) {
        reply.code(404)
        return { error: '会话不存在' }
      }
      const messages = assistantThreadRepository.listMessages(userId, id)
      return { messages: hydrateCitationSnippets(messages) }
    },
  )

  app.delete(
    '/api/assistant/threads/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const userId = request.user?.id || ''
      const { id } = /** @type {{ id: string }} */ (request.params)
      const ok = assistantThreadRepository.deleteThread(userId, id)
      if (!ok) {
        reply.code(404)
        return { error: '会话不存在' }
      }
      return { ok: true }
    },
  )

  app.post(
    '/api/assistant/chat',
    {
      preHandler: requirePermission('view'),
      schema: { body: assistantChatBodySchema },
    },
    async (request, reply) => {
      const userId = request.user?.id || ''
      const body = /** @type {{
        threadId: string
        question: string
        insightPeriodId?: string
        pageContext?: { pathname?: string; query?: Record<string, string> }
      }} */ (request.body)

      // API Key 已被 requirePermission 拦截（403）；这里再确认是登录会话
      if (!request.user) {
        reply.code(401).send({ error: '未登录' })
        return
      }

      if (!isLlmConfigured()) {
        reply.code(503).send({
          error: 'LLM 未配置',
          hint: '请由管理员在「设置」中配置大模型，或在服务端配置 LLM_API_KEY 环境变量。',
        })
        return
      }

      // 线程归属校验
      const thread = assistantThreadRepository.getThread(userId, body.threadId)
      if (!thread) {
        reply.code(404).send({ error: '会话不存在' })
        return
      }

      // 限流
      const rate = checkRateLimit(userId)
      if (!rate.ok) {
        reply.code(429).send({
          error: '提问过于频繁，请稍后再试',
          retryAfterMs: rate.retryAfterMs,
        })
        return
      }

      // 同线程并发锁
      if (!acquireThread(body.threadId)) {
        reply.code(409).send({ error: '该会话正在处理上一条提问，请稍后再发送' })
        return
      }

      try {
        const messages = assistantThreadRepository.listMessages(userId, body.threadId)
        const isFirstTurn = !messages.length

        // 构造历史（只取问句和答案正文，不回放工具原文；最近 8 轮 = 16 条）
        /** @type {{ role: 'user' | 'assistant'; content: string }[]} */
        const history = []
        for (const m of messages.slice(-16)) {
          if (m.role === 'user') {
            history.push({ role: 'user', content: String(m.payload?.question || '') })
          } else if (m.role === 'assistant') {
            history.push({ role: 'assistant', content: String(m.payload?.answer || '') })
          }
        }

        const result = await runAssistantLoop({
          question: body.question,
          history,
          insightPeriodId: body.insightPeriodId || '',
          pageContext: body.pageContext,
        })

        const { assistant: assistantMessage } = assistantThreadRepository.appendTurn(
          body.threadId,
          {
            question: body.question,
            insightPeriodId: body.insightPeriodId || '',
          },
          {
            answer: result.answer,
            citations: persistCitations(result.citations),
            links: result.links,
            toolsUsed: result.toolsUsed,
          },
          isFirstTurn ? body.question : undefined,
        )

        logAuditFromRequest(request, 'assistant.chat', {
          threadId: body.threadId,
          toolsUsed: result.toolsUsed,
        })

        return { message: assistantMessage }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        const status =
          err && typeof err === 'object' && 'statusCode' in err && Number.isFinite(err.statusCode)
            ? err.statusCode
            : 502
        reply.code(status >= 400 && status < 600 ? status : 502).send({ error: message })
      } finally {
        releaseThread(body.threadId)
      }
    },
  )
}

/**
 * 落库时不存模型写的长片段，只留定位字段。
 * @param {unknown} citations
 */
function persistCitations(citations) {
  if (!Array.isArray(citations)) return []
  return citations.map((c) => ({
    recordId: String(c?.recordId || ''),
    ticketId: c?.ticketId ? String(c.ticketId) : undefined,
    dataSourceType: c?.dataSourceType ? String(c.dataSourceType) : undefined,
    field: c?.field ? String(c.field) : undefined,
  }))
}

/**
 * 打开会话时按当前记录回填片段；记录已删除则显示「原文已删除」。
 * @param {Array<{ role: string; payload: Record<string, unknown> }>} messages
 */
function hydrateCitationSnippets(messages) {
  return messages.map((m) => {
    if (m.role !== 'assistant' || !Array.isArray(m.payload?.citations)) return m
    const citations = m.payload.citations.map((c) => {
      const recordId = String(c?.recordId || '').trim()
      if (!recordId) return c
      const record = storageRepository.getRecord(recordId)
      if (!record) return { ...c, snippet: '原文已删除' }
      const fieldKey = String(c?.field || '')
      const sourceText =
        (fieldKey && record[fieldKey]) ||
        record.painPoint ||
        record.customerRequest ||
        record.rawText ||
        record.commentText ||
        ''
      const text = String(sourceText || '').trim()
      return {
        ...c,
        ticketId: c.ticketId || record.ticketId,
        dataSourceType: c.dataSourceType || record.dataSourceType,
        snippet: text ? `${text.slice(0, 180)}${text.length > 180 ? '…' : ''}` : '',
      }
    })
    return { ...m, payload: { ...m.payload, citations } }
  })
}
