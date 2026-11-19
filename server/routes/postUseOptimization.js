import { hasPermission } from '../../src/domain/auth/permissions.js'
import { logAuditFromRequest } from '../audit.js'
import { listBackgroundTasks } from '../backgroundTaskLock.js'
import { META_KEY_POST_USE_VISITS } from '../../src/lib/postUseRating/visitRecords.js'
import { loadManagedProductCatalog } from '../../src/storage/productCatalogStore.js'
import { storageRepository } from '../storageRepository.js'
import { formatKnowledgeSnippetsForPrompt } from '../../src/lib/knowledgeBaseClient.js'
import { resolveCatalogProduct } from '../../src/lib/productCatalog/resolveCatalogProduct.js'
import { getCatalogProducts } from '../../src/lib/productCatalogLoader.js'
import {
  generatePostUseOptimizations,
  needsPostUseOptimization,
  traceComplaintTicketId,
} from '../../src/lib/postUseRating/postUseOptimization.js'

/**
 * 用后即评「优化建议（自动生成）」单条生成 + 待生成计数（2026-11-19，
 * DESIGN-用后即评抽屉优化建议 §5）。
 *
 * 单条为同步接口（抽屉内点击 → 生成 → 刷新展示）；批量走
 * POST /api/storage/records/enrich（mode=post_use_optimization，后台任务）。
 * 服务端跑 LLM 必须注入进程内 transport（enrichRunner 同款）——单条路由
 * 复用 setLlmTransport/setKbTransport + resolveSettingsForLlm，跑完即复位。
 */
import { setLlmTransport, resolveSettingsForLlm } from '../../src/lib/llmClient.js'
import { setKbTransport } from '../../src/lib/knowledgeBaseClient.js'
import { forwardLlmChatCompletion } from '../llmProxy.js'
import { buildInProcessLlmForwardArgs } from '../enrichRunner.js'
import { retrieveSnippets } from '../knowledgeBaseLoader.js'

/** @param {import('fastify').FastifyRequest} request */
function assertRetagPermission(request, reply) {
  const user = request.user
  if (!user) {
    reply.code(401).send({ error: '未登录' })
    return false
  }
  if (!hasPermission(user.role, 'retag')) {
    reply.code(403).send({ error: '无权限执行此操作' })
    return false
  }
  return true
}

/**
 * 单条生成的 LLM/KB transport 注入（与 enrichRunner 相同形态，跑完 finally 复位）。
 * @returns {Promise<import('../../src/lib/storage.js').AppSettings>}
 */
async function withInProcessLlm(rawSettings) {
  const serverConfigured = (await import('../llmConfig.js')).isLlmConfigured()
  setLlmTransport(async (body) => forwardLlmChatCompletion(buildInProcessLlmForwardArgs(body)), {
    ...rawSettings,
    llmServerConfigured: serverConfigured,
  })
  setKbTransport(async (queries) => {
    const results = queries.map((query) => {
      const productKeys = (query?.productKeys || []).map((k) => String(k ?? '').trim()).filter(Boolean)
      const seen = new Map()
      for (const productKey of productKeys) {
        for (const snippet of retrieveSnippets(productKey, String(query?.text ?? ''), (query?.tags || []))) {
          seen.set(`${snippet.productKey}|${snippet.title}`, snippet)
        }
      }
      return [...seen.values()]
    })
    return { results }
  })
  return resolveSettingsForLlm(rawSettings)
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerPostUseOptimizationRoutes(app) {
  // 待生成计数（两实体一次返回；对齐 post-use-journey/pending-count 先例）
  app.get(
    '/api/post-use-optimization/pending-count',
    { preHandler: (request, reply, done) => {
      if (!request.user) { reply.code(401).send({ error: '未登录' }); return }
      done()
    } },
    async (request) => {
      const q = /** @type {Record<string, string>} */ (request.query || {})
      const months = String(q.importMonth || '')
        .split(/[、,，;；|]/)
        .map((m) => m.trim())
        .filter(Boolean)

      const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
      const visits = Array.isArray(raw?.records) ? raw.records : []
      const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
      const traces = postUseJiraRepository.list({ limit: 0 }).items
      const inMonths = (month) => !months.length || months.includes(month)

      let visitPending = 0
      let visitTotal = 0
      for (const record of visits) {
        if (!inMonths(String(record?.importMonth || record?.visitMonth || ''))) continue
        visitTotal += 1
        if (needsPostUseOptimization(record, 'visit')) visitPending += 1
      }
      let tracePending = 0
      let traceTotal = 0
      for (const item of traces) {
        if (!inMonths(String(item?.importMonth || ''))) continue
        traceTotal += 1
        if (needsPostUseOptimization(item, 'trace')) tracePending += 1
      }
      return { visitPending, visitTotal, tracePending, traceTotal }
    },
  )

  // 单条生成（抽屉内）：entityType=visit|trace + id
  app.post('/api/post-use-optimization', async (request, reply) => {
    if (!assertRetagPermission(request, reply)) return
    const body = /** @type {{ entityType?: string, id?: string, settings?: Record<string, unknown> }} */ (
      request.body || {}
    )
    const entityType = body.entityType === 'trace' ? 'trace' : 'visit'
    const id = String(body.id || '').trim()
    if (!id) {
      reply.code(400)
      return { error: '缺少记录 id' }
    }

    // 批量任务进行中 → 409（设计 §5 并发拍板；retag 类型任务含本功能批量态）
    try {
      const active = listBackgroundTasks()
      if (active.some((task) => task.type === 'retag' || task.type === 'post_use_journey')) {
        reply.code(409)
        return { error: '后台批量任务进行中，请稍后再试' }
      }
    } catch (err) {
      request.log.warn({ err }, 'post-use-optimization task lock check failed')
    }

    // re-read 最新实体
    let entity = null
    if (entityType === 'trace') {
      const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
      entity = postUseJiraRepository.getById(id)
    } else {
      const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
      entity = (Array.isArray(raw?.records) ? raw.records : [])
        .find((item) => String(item?.id || '') === id) || null
    }
    if (!entity) {
      reply.code(404)
      return { error: '记录不存在' }
    }
    if (!needsPostUseOptimization(entity, entityType)) {
      return { ok: true, item: entity, skipped: true, reason: '已有建议或无语料' }
    }

    // 消费目录缓存前刷新（catalogCacheCoverageGuard 口径）
    const adapter = {
      getMeta: (key) => storageRepository.getMeta(key),
      putMeta: (key, value) => storageRepository.putMeta(key, value),
    }
    try {
      await loadManagedProductCatalog(adapter)
    } catch (err) {
      request.log.warn({ err }, 'post-use-optimization 产品目录刷新失败，降级用缓存')
    }

    const settings = await withInProcessLlm(body.settings || {})
    try {
      /** @type {{ complaintHandlingText?: string, knowledgeSnippets?: string, productName?: string }} */
      const extras = { productName: String(entity.productName || '') }
      if (entityType === 'trace') {
        const ticketId = traceComplaintTicketId(entity)
        if (ticketId) {
          const [source] = storageRepository.listRecordsByTicketIds('complaint_ticket', [ticketId])
          if (source) {
            const handling = String(source.handlingText || '').trim()
            extras.complaintHandlingText = handling.includes('处理意见：')
              ? handling.split('处理意见：').pop() || ''
              : handling
          }
        }
      }
      const resolved = resolveCatalogProduct(
        { productName: extras.productName },
        getCatalogProducts(),
      )
      const productKey = resolved?.key?.trim() || extras.productName
      if (productKey) {
        try {
          const snippets = retrieveSnippets(
            productKey,
            String(entity.userFeedbackText || entity.customerFeedback || ''),
            [],
          )
          extras.knowledgeSnippets = formatKnowledgeSnippetsForPrompt(snippets || [])
        } catch (err) {
          request.log.warn({ err }, 'post-use-optimization KB 检索失败，降级空片段')
        }
      }

      const result = await generatePostUseOptimizations(entity, entityType, settings, extras)
      if (!result.optimizationProduct && !result.optimizationService) {
        logAuditFromRequest(request, 'post_use_optimization.generate', {
          id, entityType, outcome: 'no_content',
        })
        return { ok: true, item: entity, skipped: true, reason: '未产出建议（无语料或规则未命中）' }
      }

      let saved = null
      if (entityType === 'trace') {
        const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
        saved = postUseJiraRepository.mergeOptimizationPatch(id, result)
      } else {
        const { mergeVisitOptimizationPatch } = await import('../postUseVisitOptimizationStore.js')
        saved = await mergeVisitOptimizationPatch(id, result)
      }
      if (!saved) {
        reply.code(409)
        return { error: '记录刚被他人更新，请刷新后重试' }
      }
      logAuditFromRequest(request, 'post_use_optimization.generate', {
        id, entityType, source: result.optimizationSource,
      })
      return { ok: true, item: saved }
    } finally {
      // transport 复位（enrichRunner finally 同款，防污染浏览器模式）
      setLlmTransport(null, null)
      setKbTransport(null)
    }
  })
}
