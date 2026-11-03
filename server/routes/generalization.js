import { requirePermission } from '../middleware.js'
import { generalizationRepository } from '../generalizationRepository.js'
import { logAuditFromRequest } from '../audit.js'
import {
  generalizationIssueCreateBodySchema,
  generalizationIssueIdParamsSchema,
  generalizationIssuePatchBodySchema,
  generalizationLinkCreateBodySchema,
  generalizationLinkParamsSchema,
  generalizationLinkReviewParamsSchema,
  generalizationLinkReviewBodySchema,
  generalizationHintParamsSchema,
  generalizationRecordSearchParamsSchema,
  generalizationScanBodySchema,
  generalizationFromActionBodySchema,
} from '../schemas/generalizationSchemas.js'

/**
 * 举一反三路由 —— docs/DESIGN-20261102-1.md §4.1
 * 权限：查看=view；写=editRecord；scan=import。
 * 审计：全部写操作记 audit_log（action 名 generalization.*）。
 * @param {import('fastify').FastifyInstance} app
 */
export function registerGeneralizationRoutes(app) {
  // ── 清单 / 详情 / 新建 / 编辑 / 删除 ──

  app.get(
    '/api/generalization/issues',
    { preHandler: requirePermission('view') },
    async (request) => {
      const q = request.query || {}
      return generalizationRepository.listIssues({
        page: Number(q.page) || 1,
        pageSize: Number(q.pageSize) || 20,
        productKey: typeof q.productKey === 'string' ? q.productKey : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        category: typeof q.category === 'string' ? q.category : undefined,
        scope: typeof q.scope === 'string' ? q.scope : undefined,
        keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
        actionItemId: typeof q.actionItemId === 'string' ? q.actionItemId : undefined,
      })
    },
  )

  app.post(
    '/api/generalization/issues',
    {
      preHandler: requirePermission('editRecord'),
      schema: { body: generalizationIssueCreateBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {any} */ (request.body)
      try {
        // 新建前同产品轻量去重检测（提示不强制——设计 §5.1）
        const similar = generalizationRepository.findSimilarIssues({
          title: body.title,
          summary: body.summary,
          productKey: body.productKey,
          limit: 3,
        })
        const issue = generalizationRepository.putIssue(body, {
          firstLink: body.firstLink,
          actor: request.user
            ? { userId: request.user.id, username: request.user.username }
            : undefined,
        })
        logAuditFromRequest(request, 'generalization.issue_create', {
          issueId: issue.id,
          title: issue.title,
          category: issue.category,
          scope: issue.scope,
          withFirstLink: Boolean(body.firstLink?.recordId),
        })
        return { issue, similarHints: similar }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.get(
    '/api/generalization/issues/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const issue = generalizationRepository.getIssue(id)
      if (!issue) return replyNotFound(reply, '举一反三问题不存在')
      return {
        issue,
        links: generalizationRepository.listLinksByIssue(id),
        actionRefs: generalizationRepository.listActionRefsForIssue(id),
      }
    },
  )

  app.patch(
    '/api/generalization/issues/:id',
    {
      preHandler: requirePermission('editRecord'),
      schema: {
        params: generalizationIssueIdParamsSchema,
        body: generalizationIssuePatchBodySchema,
      },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const body = /** @type {any} */ (request.body)
      try {
        const issue = generalizationRepository.updateIssue(id, body)
        logAuditFromRequest(request, 'generalization.issue_update', {
          issueId: id,
          fields: Object.keys(body),
          statusChanged: body.status !== undefined,
        })
        return { issue }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.delete(
    '/api/generalization/issues/:id',
    {
      preHandler: requirePermission('editRecord'),
      schema: { params: generalizationIssueIdParamsSchema },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        const { linksDeleted, actionRefsDeleted } = generalizationRepository.deleteIssue(id)
        logAuditFromRequest(request, 'generalization.issue_delete', {
          issueId: id,
          linksDeleted,
          actionRefsDeleted,
        })
        return { ok: true, linksDeleted, actionRefsDeleted }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  // ── 证据链 links ──

  app.post(
    '/api/generalization/issues/:id/links',
    {
      preHandler: requirePermission('editRecord'),
      schema: {
        params: generalizationIssueIdParamsSchema,
        body: generalizationLinkCreateBodySchema,
      },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const body = /** @type {any} */ (request.body)
      const { buildGeneralizationLinkFromInput } = await import(
        '../../src/domain/generalizationIssue.js'
      )
      const { link, errors } = buildGeneralizationLinkFromInput({
        issueId: id,
        recordId: body.recordId,
        recordDataSource: body.recordDataSource,
        ticketId: body.ticketId,
        linkStatus: 'confirmed',
        linkSource: 'manual',
      })
      if (errors.length) {
        reply.code(400)
        return { error: errors.join('；') }
      }
      try {
        const result = generalizationRepository.putLink(link, {
          actor: request.user
            ? { userId: request.user.id, username: request.user.username }
            : undefined,
          overrideDismissed: body.overrideDismissed === true,
        })
        logAuditFromRequest(request, 'generalization.link_attach', {
          issueId: id,
          recordId: body.recordId,
          result: result.action,
          overrideDismissed: body.overrideDismissed === true,
        })
        if (result.action.startsWith('skipped')) {
          reply.code(409)
          return { error: '该记录与此问题已存在关联或已被人工处理', result }
        }
        return { link: result.link }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.delete(
    '/api/generalization/issues/:id/links/:linkId',
    {
      preHandler: requirePermission('editRecord'),
      schema: { params: generalizationLinkParamsSchema },
    },
    async (request, reply) => {
      const { linkId } = /** @type {{ id: string, linkId: string }} */ (request.params)
      try {
        const { link } = generalizationRepository.deleteLink(linkId)
        logAuditFromRequest(request, 'generalization.link_detach', {
          issueId: link.issueId,
          recordId: link.recordId,
        })
        return { ok: true }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  // ── 按记录反查（抽屉卡数据源）──

  app.get(
    '/api/generalization/records/:recordId/links',
    { preHandler: requirePermission('view') },
    async (request) => {
      const { recordId } = /** @type {{ recordId: string }} */ (request.params)
      return { links: generalizationRepository.listLinksByRecord(recordId) }
    },
  )

  app.get(
    '/api/generalization/records/:recordId/hint',
    { preHandler: requirePermission('view') },
    async (request) => {
      const { recordId } = /** @type {{ recordId: string }} */ (request.params)
      return { hint: generalizationRepository.getHint(recordId) }
    },
  )

  // ── 人工兜底搜记录 ──

  app.get(
    '/api/generalization/records/search',
    {
      preHandler: requirePermission('view'),
      schema: { querystring: generalizationRecordSearchParamsSchema },
    },
    async (request) => {
      const q = /** @type {any} */ (request.query)
      return {
        records: generalizationRepository.searchRecordsForAttach({
          query: q.query,
          productKey: q.productKey,
          limit: q.limit,
        }),
      }
    },
  )

  // ── 待复核队列 + 三选一 ──

  app.get(
    '/api/generalization/matches/pending-count',
    { preHandler: requirePermission('view') },
    async () => generalizationRepository.pendingCount(),
  )

  app.get(
    '/api/generalization/matches',
    { preHandler: requirePermission('view') },
    async (request) => {
      const q = request.query || {}
      return generalizationRepository.listPendingSuggestions({
        page: Number(q.page) || 1,
        pageSize: Number(q.pageSize) || 20,
        confidence: typeof q.confidence === 'string' ? q.confidence : undefined,
      })
    },
  )

  app.post(
    '/api/generalization/matches/:linkId/review',
    {
      preHandler: requirePermission('editRecord'),
      schema: {
        params: generalizationLinkReviewParamsSchema,
        body: generalizationLinkReviewBodySchema,
      },
    },
    async (request, reply) => {
      const { linkId } = /** @type {{ linkId: string }} */ (request.params)
      const body = /** @type {any} */ (request.body)
      try {
        const result = generalizationRepository.reviewSuggestion(linkId, body.action, {
          newIssue: body.newIssue,
          actor: request.user
            ? { userId: request.user.id, username: request.user.username }
            : undefined,
        })
        logAuditFromRequest(request, 'generalization.match_review', {
          linkId,
          action: body.action,
          newIssueId: body.action === 'new_issue' ? result.issue?.id : undefined,
        })
        return result
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  // ── hint adopt / dismiss（抽屉建议条两按钮）──

  app.post(
    '/api/generalization/hints/:recordId/adopt',
    {
      preHandler: requirePermission('editRecord'),
      schema: { params: generalizationHintParamsSchema },
    },
    async (request, reply) => {
      const { recordId } = /** @type {{ recordId: string }} */ (request.params)
      try {
        const result = generalizationRepository.decideHint(recordId, 'adopt', {
          actor: request.user
            ? { userId: request.user.id, username: request.user.username }
            : undefined,
        })
        logAuditFromRequest(request, 'generalization.hint_adopt', {
          recordId,
          issueId: result.issue?.id,
          category: result.hint?.category,
        })
        return result
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.post(
    '/api/generalization/hints/:recordId/dismiss',
    {
      preHandler: requirePermission('editRecord'),
      schema: { params: generalizationHintParamsSchema },
    },
    async (request, reply) => {
      const { recordId } = /** @type {{ recordId: string }} */ (request.params)
      try {
        const result = generalizationRepository.decideHint(recordId, 'dismiss', {
          actor: request.user
            ? { userId: request.user.id, username: request.user.username }
            : undefined,
        })
        logAuditFromRequest(request, 'generalization.hint_dismiss', { recordId })
        return result
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  // ── 举措升级（from-action 双模式：create 新建 / link 关联已有）──

  app.post(
    '/api/generalization/from-action',
    {
      preHandler: requirePermission('editRecord'),
      schema: { body: generalizationFromActionBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {any} */ (request.body)
      const actor = request.user
        ? { userId: request.user.id, username: request.user.username }
        : undefined

      // 举措存在性 + 证据收集（dataSourceType 过滤只取投诉/咨询）+ 产品从举措带入（body 不传产品——升级语义）
      const actionInfo = await collectActionEvidence(body.actionItemId)
      if (actionInfo === null) {
        return replyNotFound(reply, '举措不存在')
      }
      const { evidence, productKey, productName } = actionInfo

      try {
        if (body.mode === 'link') {
          // 关联已有：issueId 必填（schema 层无法条件必填，路由层二次校验）
          if (!body.issueId) {
            reply.code(400)
            return { error: 'mode=link 必须携带 issueId' }
          }
          const result = generalizationRepository.linkIssueToAction({
            actionItemId: body.actionItemId,
            issueId: body.issueId,
            evidence,
            actor,
          })
          logAuditFromRequest(request, 'generalization.from_action', {
            actionItemId: body.actionItemId,
            mode: 'link',
            issueId: body.issueId,
            evidenceLinked: result.evidenceLinked,
            evidenceSkipped: result.evidenceSkipped,
          })
          return result
        }

        // mode=create：新建 gen issue（仅 optimization 预填；root_cause 不预填——23:39 定稿）
        const result = generalizationRepository.createIssueFromAction({
          actionItemId: body.actionItemId,
          issueInput: {
            productKey,
            productName,
            title: body.title,
            summary: body.summary,
            category: body.category,
            scope: body.scope,
            optimization: body.optimization,
            keywords: body.keywords,
            notes: body.notes,
            categoryOther: body.categoryOther,
          },
          evidence,
          actor,
        })
        logAuditFromRequest(request, 'generalization.from_action', {
          actionItemId: body.actionItemId,
          mode: 'create',
          issueId: result.issue?.id,
          evidenceLinked: result.evidenceLinked,
          evidenceSkipped: result.evidenceSkipped,
        })
        return result
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  // ── 手动补跑 scan（G0 stub：G2 落地引擎后生效；现返回未实现）──

  app.post(
    '/api/generalization/scan',
    {
      preHandler: requirePermission('import'),
      schema: { body: generalizationScanBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {any} */ (request.body)
      const user = request.user
      const userId = user?.id || 'system'
      const username = user?.username || user?.id || 'system'

      const { acquireBackgroundTaskLock, startBackgroundTaskHeartbeat } = await import(
        '../backgroundTaskLock.js'
      )
      let acquiredLock = null
      try {
        const { lock } = acquireBackgroundTaskLock('retag', {
          id: userId,
          username,
          progress: '正在准备举一反三识别…',
          meta: {
            phase: 'server',
            source: '举一反三识别',
            importMonth: body.importMonth,
            total: body.recordIds?.length,
          },
        })
        acquiredLock = lock
      } catch (err) {
        const e = /** @type {Error & { code?: string }} */ (err)
        if (e.code === 'BACKGROUND_TASK_CONFLICT') {
          return reply.code(409).send({ error: e.message, code: e.code })
        }
        throw err
      }
      const taskId = acquiredLock.id
      const stopHeartbeat = startBackgroundTaskHeartbeat(taskId)
      logAuditFromRequest(request, 'generalization.scan_start', {
        taskId,
        importMonth: body.importMonth,
        recordCount: body.recordIds?.length,
        generalizationOnly: body.generalizationOnly === true,
        gPassRetry: body.gPassRetry === true,
      })

      // 同一 observation_match 任务（TASKS G2-4 口径：不注册新 mode），generalizationOnly 跳过留观段
      ;(async () => {
        try {
          const { runEnrichment } = await import('../enrichRunner.js')
          const result = await runEnrichment({
            mode: 'observation_match',
            taskId,
            records: [],
            recordIds: body.recordIds || [],
            settings: {},
            userId,
            username,
            retagOptions: {
              importMonth: body.importMonth || '',
              generalizationOnly: body.generalizationOnly === true,
              gPassRetry: body.gPassRetry === true,
            },
          })
          const stats = result.stats || {}
          // 结果写独立 meta key（对齐观察 result 双写模式）
          const { storageRepository: repo } = await import('../storageRepository.js')
          repo.putMeta('generalization_scan_last_result', {
            taskId,
            finishedAt: new Date().toISOString(),
            stats,
            warnings: result.warnings || [],
            cancelled: stats.cancelled === true,
          })
        } catch (err) {
          console.error('[generalization scan] 执行失败:', err)
          const { storageRepository: repo } = await import('../storageRepository.js')
          repo.putMeta('generalization_scan_last_result', {
            taskId,
            finishedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          })
        } finally {
          stopHeartbeat?.()
        }
      })()

      return {
        ok: true,
        taskId,
        message: body.generalizationOnly
          ? '举一反三识别已在后台启动（跳过留观段）'
          : '留观与举一反三识别已在后台启动',
      }
    },
  )
}

/**
 * 收集举措证据：action_items payload 的 evidenceRecordIds/linkedTicketIds/linkedDataSources
 * → 逐 record 解析 dataSourceType，过滤只留投诉/咨询（评价不参与升级挂载——设计 §4.1）。
 * @param {string} actionItemId
 * @returns {Promise<{ evidence: Array<{ recordId: string, recordDataSource: string, ticketId?: string }>, productKey: string, productName: string } | null>} null = 举措不存在
 */
async function collectActionEvidence(actionItemId) {
  const { getDb } = await import('../db.js')
  const db = getDb()
  const row = db
    .prepare('SELECT id, payload, product_key, product_name FROM action_items WHERE id = ?')
    .get(String(actionItemId || ''))
  if (!row) return null
  /** @type {{ evidenceRecordIds?: string[], linkedTicketIds?: string[], linkedDataSources?: string[] }} */
  let actionPayload = {}
  try {
    actionPayload = JSON.parse(row.payload || '{}')
  } catch {
    actionPayload = {}
  }
  const recordIds = Array.isArray(actionPayload.evidenceRecordIds)
    ? actionPayload.evidenceRecordIds.map(String)
    : []
  /** @type {Array<{ recordId: string, recordDataSource: string, ticketId?: string }>} */
  const evidence = []
  const stmt = db.prepare('SELECT payload FROM records WHERE id = ?')
  for (const recordId of recordIds) {
    const rec = stmt.get(recordId)
    if (!rec?.payload) continue
    try {
      const payload = JSON.parse(rec.payload)
      const dsType = String(payload?.dataSourceType || '')
      // 只取投诉/咨询（post_use_rating 过滤——设计 §4.1）
      if (dsType !== 'complaint_ticket' && dsType !== 'consultation_ticket') continue
      evidence.push({
        recordId,
        recordDataSource: dsType,
        ticketId: String(payload?.ticketId || '') || undefined,
      })
    } catch {
      // 跳过损坏行
    }
  }
  return {
    evidence,
    productKey: String(row.product_key || ''),
    productName: String(row.product_name || ''),
  }
}

/** @param {import('fastify').FastifyReply} reply @param {unknown} err */
function replyValidationError(reply, err) {
  const e = /** @type {Error & { code?: string }} */ (err)
  if (
    e.code === 'GENERALIZATION_ISSUE_NOT_FOUND' ||
    e.code === 'GENERALIZATION_LINK_NOT_FOUND'
  ) {
    reply.code(404)
    return { error: e.message }
  }
  if (e.code === 'GENERALIZATION_VALIDATION') {
    reply.code(400)
    return { error: e.message }
  }
  if (
    e.code === 'GENERALIZATION_LINK_CONFLICT' ||
    e.code === 'GENERALIZATION_UPGRADE_CONFLICT'
  ) {
    reply.code(409)
    return { error: e.message }
  }
  throw err
}

/** @param {import('fastify').FastifyReply} reply @param {string} message */
function replyNotFound(reply, message) {
  reply.code(404)
  return { error: message }
}
