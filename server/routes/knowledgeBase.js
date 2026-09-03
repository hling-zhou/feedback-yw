import { requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import {
  knowledgeBaseRetrieveBodySchema,
  knowledgeBaseUploadBodySchema,
  knowledgeBaseProductKeyParamsSchema,
} from '../schemas/knowledgeBaseSchemas.js'
import { retrieveSnippets, clearKnowledgeBaseCache } from '../knowledgeBaseLoader.js'
import {
  listKnowledgeBases,
  upsertKnowledgeBase,
  deleteKnowledgeBase,
} from '../knowledgeBaseRepository.js'

/** 上传路由单独放宽 body 限制，容纳较大 KB JSON */
const UPLOAD_BODY_LIMIT = 20 * 1024 * 1024

/**
 * 产品知识库检索 / 管理路由。
 *
 * @param {import('fastify').FastifyInstance} app
 */
export function registerKnowledgeBaseRoutes(app) {
  /**
   * 批量检索：接收多个 query（每 query 含 productKeys + text + tags），
   * 返回每 query 合并各 productKey 片段、去重后的片段集。
   */
  app.post(
    '/api/knowledge-base/retrieve',
    { preHandler: requirePermission('view'), schema: { body: knowledgeBaseRetrieveBodySchema } },
    async (request) => {
      const body = /** @type {{ queries: Array<{ productKeys: string[]; text: string; tags?: string[] }> }} */ (
        request.body
      )
      const queries = Array.isArray(body?.queries) ? body.queries : []
      const results = queries.map((query) => {
        const productKeys = (query?.productKeys || [])
          .map((k) => String(k ?? '').trim().toLowerCase())
          .filter(Boolean)
        const text = String(query?.text ?? '')
        const tags = (query?.tags || []).map((t) => String(t ?? '').trim()).filter(Boolean)
        /** 合并各 productKey 片段，按 title 去重 */
        /** @type {Map<string, { title: string; content: string; productKey: string }>} */
        const seen = new Map()
        for (const productKey of productKeys) {
          const snippets = retrieveSnippets(productKey, text, tags)
          for (const s of snippets) {
            const key = `${s.productKey}|${s.title}`
            if (!seen.has(key)) seen.set(key, s)
          }
        }
        return [...seen.values()]
      })
      return { results }
    },
  )

  /** 列出已上传知识库（不含 payload） */
  app.get(
    '/api/knowledge-base',
    { preHandler: requirePermission('view') },
    async () => ({ items: listKnowledgeBases() }),
  )

  /**
   * 上传/替换知识库：body 即整份 KB JSON（含 productLine / details）。
   * productKey 取 productLine 小写；payload 存原始 JSON 字符串。
   */
  app.post(
    '/api/knowledge-base/upload',
    {
      preHandler: requirePermission('manageKnowledgeBase'),
      bodyLimit: UPLOAD_BODY_LIMIT,
      schema: { body: knowledgeBaseUploadBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {{ productLine: string; productName?: string; exportDate?: string; details: unknown[] }} */ (
        request.body
      )
      const productKey = String(body.productLine ?? '').trim().toLowerCase()
      if (!productKey) return reply.code(400).send({ error: 'productLine 不能为空' })
      if (!Array.isArray(body.details) || body.details.length === 0) {
        return reply.code(400).send({ error: 'details 不能为空' })
      }
      const payload = JSON.stringify(body)
      const summary = upsertKnowledgeBase({
        productKey,
        productName: String(body.productName ?? ''),
        exportDate: String(body.exportDate ?? ''),
        payload,
        user: { id: request.user?.id ?? null, username: request.user?.username ?? '' },
      })
      clearKnowledgeBaseCache()
      logAuditFromRequest(request, 'knowledge_base.upload', {
        productKey: summary.productKey,
        productName: summary.productName,
        sizeBytes: summary.sizeBytes,
      })
      reply.code(201)
      return { item: summary }
    },
  )

  /** 删除知识库 */
  app.delete(
    '/api/knowledge-base/:productKey',
    {
      preHandler: requirePermission('manageKnowledgeBase'),
      schema: { params: knowledgeBaseProductKeyParamsSchema },
    },
    async (request, reply) => {
      const params = /** @type {{ productKey: string }} */ (request.params)
      const productKey = String(params.productKey ?? '').trim().toLowerCase()
      const removed = deleteKnowledgeBase(productKey)
      if (!removed) return reply.code(404).send({ error: '知识库不存在' })
      clearKnowledgeBaseCache()
      logAuditFromRequest(request, 'knowledge_base.delete', { productKey })
      return { ok: true, productKey }
    },
  )
}
