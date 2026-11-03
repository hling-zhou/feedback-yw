import { requirePermission } from '../middleware.js'
import { observationRepository } from '../observationRepository.js'
import { logAuditFromRequest } from '../audit.js'
import {
  observationIssueCreateBodySchema,
  observationIssueIdParamsSchema,
  observationIssuePatchBodySchema,
  observationLinkCreateBodySchema,
  observationLinkParamsSchema,
  observationLinkReviewParamsSchema,
  observationLinkReviewBodySchema,
  observationRecordSearchParamsSchema,
  observationScanBodySchema,
} from '../schemas/observationSchemas.js'

/**
 * 留观问题路由 —— docs/DESIGN-20261031-1.md §4.2
 * 权限：查看=view；写=editRecord；scan=import（引擎 O2 落地后接线）。
 * @param {import('fastify').FastifyInstance} app
 */
export function registerObservationRoutes(app) {
  app.get(
    '/api/observation/issues',
    { preHandler: requirePermission('view') },
    async (request) => {
      const q = request.query || {}
      return observationRepository.listIssues({
        page: Number(q.page) || 1,
        pageSize: Number(q.pageSize) || 20,
        productKey: typeof q.productKey === 'string' ? q.productKey : undefined,
        status: typeof q.status === 'string' ? q.status : undefined,
        sourceMix:
          q.sourceMix === 'has_ticket' || q.sourceMix === 'rating_only' ? q.sourceMix : 'all',
        keyword: typeof q.keyword === 'string' ? q.keyword : undefined,
      })
    },
  )

  // 注意：必须注册在 /api/observation/issues/:id 之前，否则 "stats" 会被当作 :id 吞掉
  app.get(
    '/api/observation/issues/stats',
    { preHandler: requirePermission('view') },
    async () => observationRepository.getIssueStats(),
  )

  app.post(
    '/api/observation/issues',
    {
      preHandler: requirePermission('editRecord'),
      schema: { body: observationIssueCreateBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {any} */ (request.body)
      try {
        const issue = observationRepository.putIssue(
          {
            productKey: body.productKey,
            productName: body.productName,
            title: body.title,
            summary: body.summary,
            keywords: body.keywords,
            notes: body.notes,
          },
          {
            firstLink: body.firstLink,
            actor: request.user
              ? { userId: request.user.id, username: request.user.username }
              : undefined,
          },
        )
        logAuditFromRequest(request, 'observation.issue_create', {
          issueId: issue.id,
          title: issue.title,
          withFirstLink: Boolean(body.firstLink?.recordId),
        })
        return { issue }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.get(
    '/api/observation/issues/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const issue = observationRepository.getIssue(id)
      if (!issue) return replyNotFound(reply, '留观问题不存在')
      return { issue, links: observationRepository.listLinksByIssue(id) }
    },
  )

  app.patch(
    '/api/observation/issues/:id',
    {
      preHandler: requirePermission('editRecord'),
      schema: {
        params: observationIssueIdParamsSchema,
        body: observationIssuePatchBodySchema,
      },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const body = /** @type {any} */ (request.body)
      try {
        const issue = observationRepository.updateIssue(id, {
          title: body.title,
          summary: body.summary,
          status: body.status,
          keywords: body.keywords,
          notes: body.notes,
        })
        logAuditFromRequest(request, 'observation.issue_update', {
          issueId: id,
          fields: Object.keys(body),
        })
        return { issue }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.delete(
    '/api/observation/issues/:id',
    {
      preHandler: requirePermission('editRecord'),
      schema: { params: observationIssueIdParamsSchema },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      try {
        const { linksDeleted } = observationRepository.deleteIssue(id)
        logAuditFromRequest(request, 'observation.issue_delete', {
          issueId: id,
          linksDeleted,
        })
        return { ok: true, linksDeleted }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.post(
    '/api/observation/issues/:id/links',
    {
      preHandler: requirePermission('editRecord'),
      schema: {
        params: observationIssueIdParamsSchema,
        body: observationLinkCreateBodySchema,
      },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const body = /** @type {any} */ (request.body)
      const { buildObservationLinkFromInput } = await import(
        '../../src/domain/observationIssue.js'
      )
      const { link, errors } = buildObservationLinkFromInput({
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
        const result = observationRepository.putLink(link, {
          actor: request.user
            ? { userId: request.user.id, username: request.user.username }
            : undefined,
          overrideDismissed: body.overrideDismissed === true,
        })
        logAuditFromRequest(request, 'observation.link_attach', {
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
    '/api/observation/issues/:id/links/:linkId',
    {
      preHandler: requirePermission('editRecord'),
      schema: { params: observationLinkParamsSchema },
    },
    async (request, reply) => {
      const { linkId } = /** @type {{ id: string, linkId: string }} */ (request.params)
      try {
        const { link } = observationRepository.deleteLink(linkId)
        logAuditFromRequest(request, 'observation.link_detach', {
          issueId: link.issueId,
          recordId: link.recordId,
        })
        return { ok: true }
      } catch (err) {
        return replyValidationError(reply, err)
      }
    },
  )

  app.get(
    '/api/observation/matches/pending-count',
    { preHandler: requirePermission('view') },
    async () => observationRepository.pendingCount(),
  )

  app.get(
    '/api/observation/matches',
    { preHandler: requirePermission('view') },
    async (request) => {
      const q = request.query || {}
      return observationRepository.listPendingSuggestions({
        page: Number(q.page) || 1,
        pageSize: Number(q.pageSize) || 20,
        confidence: typeof q.confidence === 'string' ? q.confidence : undefined,
      })
    },
  )

  app.post(
    '/api/observation/matches/:linkId/review',
    {
      preHandler: requirePermission('editRecord'),
      schema: {
        params: observationLinkReviewParamsSchema,
        body: observationLinkReviewBodySchema,
      },
    },
    async (request, reply) => {
      const { linkId } = /** @type {{ linkId: string }} */ (request.params)
      const body = /** @type {any} */ (request.body)
      try {
        const result = observationRepository.reviewSuggestion(linkId, body.action, {
          newIssue: body.newIssue,
          actor: request.user
            ? { userId: request.user.id, username: request.user.username }
            : undefined,
        })
        logAuditFromRequest(request, 'observation.match_review', {
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

  app.get(
    '/api/observation/records/search',
    {
      preHandler: requirePermission('view'),
      schema: { querystring: observationRecordSearchParamsSchema },
    },
    async (request) => {
      const q = /** @type {any} */ (request.query)
      return {
        records: observationRepository.searchRecordsForAttach({
          query: q.query,
          productKey: q.productKey,
          limit: q.limit,
        }),
      }
    },
  )

  app.get(
    '/api/observation/records/:recordId/links',
    { preHandler: requirePermission('view') },
    async (request) => {
      const { recordId } = /** @type {{ recordId: string }} */ (request.params)
      return { links: observationRepository.listLinksByRecord(recordId) }
    },
  )

  app.post(
    '/api/observation/issues/:id/promote',
    {
      preHandler: requirePermission('editRecord'),
      schema: { params: observationIssueIdParamsSchema },
    },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const { observationRepository } = await import('../observationRepository.js')
      const { getDb } = await import('../db.js')
      const issue = observationRepository.getIssue(id)
      if (!issue) {
        reply.code(404)
        return { error: '留观问题不存在' }
      }
      if (issue.status !== 'watching') {
        reply.code(409)
        return { error: '该留观问题已升级或已关闭，不能重复升级' }
      }
      const confirmed = observationRepository.listLinksByIssue(id).filter((l) => l.linkStatus === 'confirmed')
      const db = getDb()
      /** @type {string[]} */
      const linkedTicketIds = []
      /** @type {string[]} */
      const linkedDataSources = []
      let representativeDetail = ''
      for (const link of confirmed) {
        if (link.ticketId) linkedTicketIds.push(link.ticketId)
        if (link.recordDataSource) linkedDataSources.push(link.recordDataSource)
        const row = db.prepare('SELECT payload FROM records WHERE id = ?').get(link.recordId)
        if (!row?.payload) continue
        try {
          const payload = JSON.parse(row.payload)
          const piece = String(
            payload.painPoint || payload.commentText || payload.customerRequest || '',
          ).trim()
          if (piece) representativeDetail += (representativeDetail ? '；' : '') + piece.slice(0, 80)
        } catch {
          // 跳过损坏行
        }
      }
      const detail = [issue.summary, representativeDetail ? `代表证据：${representativeDetail.slice(0, 300)}` : '']
        .filter(Boolean)
        .join('\n')

      const { randomId } = await import('../../src/lib/randomId.js')
      const now = new Date().toISOString()
      const actionItemId = randomId()
      // 写 action_items（source=observation，待评估——人工在举措模块正常跟进）
      db.prepare(
        `INSERT INTO action_items
         (id, product_key, product_name, status, source, first_proposed_at, schedule_at, warning_level, payload)
         VALUES (?, ?, ?, 'pending_evaluation', 'observation', ?, '', 'none', ?)`,
      ).run(
        actionItemId,
        issue.productKey,
        issue.productName,
        issue.firstSeenAt?.slice(0, 10) || now.slice(0, 10),
        JSON.stringify({
          id: actionItemId,
          content: issue.title,
          detail,
          status: 'pending_evaluation',
          source: 'observation',
          productKey: issue.productKey,
          productName: issue.productName,
          firstProposedAt: issue.firstSeenAt?.slice(0, 10) || now.slice(0, 10),
          linkedTicketIds,
          linkedDataSources,
          evidenceRecordIds: confirmed.map((l) => l.recordId),
          createdAt: now,
          updatedAt: now,
          promotedFromObservation: { issueId: issue.id, promotedAt: now },
        }),
      )
      // issue → promoted（links 保留：证据与审计不灭）
      observationRepository.updateIssue(id, {
        status: 'promoted',
      })
      const { getDb: _g } = await import('../db.js')
      _g()
        .prepare(`UPDATE observation_issues SET payload = json_set(payload, '$.promotedTo', ?) WHERE id = ?`)
        .run(
          JSON.stringify({ actionItemId, promotedAt: now, promotedBy: request.user?.username || '' }),
          id,
        )
      logAuditFromRequest(request, 'observation.issue_promote', {
        issueId: id,
        actionItemId,
        evidenceCount: confirmed.length,
      })
      return { ok: true, actionItemId }
    },
  )

  app.post(
    '/api/observation/scan',
    {
      preHandler: requirePermission('import'),
      schema: { body: observationScanBodySchema },
    },
    async (request, reply) => {
      const body = /** @type {{ importMonth?: string, recordIds?: string[] }} */ (request.body)
      const user = request.user
      const userId = user?.id || 'system'
      const username = user?.username || user?.id || 'system'

      const { acquireBackgroundTaskLock, startBackgroundTaskHeartbeat, isTaskCancelled } = await import(
        '../backgroundTaskLock.js'
      )
      let acquiredLock = null
      try {
        const { lock } = acquireBackgroundTaskLock('retag', {
          id: userId,
          username,
          progress: '正在准备留观自动识别…',
          meta: {
            phase: 'server',
            source: '留观自动识别',
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
      logAuditFromRequest(request, 'observation.scan_start', {
        taskId,
        importMonth: body.importMonth,
        recordCount: body.recordIds?.length,
      })

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
            retagOptions: { importMonth: body.importMonth || '' },
          })
          const stats = result.stats || {}
          // 结果写独立 meta key（对齐行动建议 result 双写模式）
          const { storageRepository: repo } = await import('../storageRepository.js')
          repo.putMeta('observation_scan_last_result', {
            taskId,
            finishedAt: new Date().toISOString(),
            stats,
            warnings: result.warnings || [],
            cancelled: stats.cancelled === true,
          })
        } catch (err) {
          console.error('[observation scan] 执行失败:', err)
          const { storageRepository: repo } = await import('../storageRepository.js')
          repo.putMeta('observation_scan_last_result', {
            taskId,
            finishedAt: new Date().toISOString(),
            error: err instanceof Error ? err.message : String(err),
          })
        } finally {
          stopHeartbeat?.()
        }
        void isTaskCancelled
      })()

      return { ok: true, taskId, message: '留观自动识别已在后台启动' }
    },
  )
}

/** @param {import('fastify').FastifyReply} reply @param {unknown} err */
function replyValidationError(reply, err) {
  const e = /** @type {Error & { code?: string }} */ (err)
  if (e.code === 'OBSERVATION_ISSUE_NOT_FOUND' || e.code === 'OBSERVATION_LINK_NOT_FOUND') {
    reply.code(404)
    return { error: e.message }
  }
  if (e.code === 'OBSERVATION_VALIDATION') {
    reply.code(400)
    return { error: e.message }
  }
  if (e.code === 'OBSERVATION_LINK_CONFLICT') {
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
