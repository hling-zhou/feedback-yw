import { hasPermission } from '../../src/domain/auth/permissions.js'
import {
  artifactPutBodySchema,
  backgroundTaskAcquireBodySchema,
  backgroundTaskTouchBodySchema,
  clearImportedDataQuerySchema,
  followUpSatisfactionImportBodySchema,
  insightRebuildBodySchema,
  metaKeyParamsSchema,
  metaPutBodySchema,
  periodPutBodySchema,
  recordIdParamsSchema,
  recordPatchBodySchema,
  recordsBatchBodySchema,
  recordsReplaceBodySchema,
  runPutBodySchema,
  snapshotPutBodySchema,
  tagCandidateIdParamsSchema,
  tagCandidatesPutBodySchema,
} from '../schemas/storageWriteSchemas.js'
import { requireAdmin, requirePermission } from '../middleware.js'
import { bumpDataRevision, getDataRevision } from '../dataRevision.js'
import { storageRepository, TICKET_ID_CONFLICT_CODE } from '../storageRepository.js'
import {
  getProductCatalogPublishStatus,
  publishProductCatalogToFiles,
} from '../productCatalogPublish.js'
import { logAuditFromRequest } from '../audit.js'
import { scheduleConfigAutoPublish } from '../autoPublishConfig.js'
import { getTaxonomyPublishStatus, publishTaxonomyToFiles } from '../taxonomyPublish.js'
import { readTaxonomyManagedMetaHydrated } from '../taxonomyMetaHygiene.js'
import {
  enqueueInsightRebuild,
  getInsightRebuildJob,
  listInsightRebuildJobs as listInsightRebuildJobsForPeriod,
} from '../insightRebuildJob.js'
import {
  acquireBackgroundTaskLock,
  getBackgroundTaskLock,
  releaseBackgroundTaskLock,
  touchBackgroundTaskLock,
} from '../backgroundTaskLock.js'

/** @param {import('fastify').FastifyRequest} request */
function assertWritePermission(request, reply, permissions) {
  const user = request.user
  if (!user) {
    reply.code(401).send({ error: '未登录' })
    return false
  }
  const allowed = permissions.some((p) => hasPermission(user.role, p))
  if (!allowed) {
    reply.code(403).send({ error: '无权限执行此操作' })
    return false
  }
  return true
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerStorageRoutes(app) {
  app.post('/api/storage/init', { preHandler: requirePermission('view') }, async () => {
    await storageRepository.init()
    return { ok: true, stats: storageRepository.getStats() }
  })

  app.get('/api/storage/stats', { preHandler: requirePermission('view') }, async () => {
    return storageRepository.getStats()
  })

  app.get('/api/storage/revision', { preHandler: requirePermission('view') }, async () => {
    return getDataRevision()
  })

  app.get('/api/storage/background-task', { preHandler: requirePermission('view') }, async () => {
    return { lock: getBackgroundTaskLock() }
  })

  app.post(
    '/api/storage/background-task/acquire',
    { schema: { body: backgroundTaskAcquireBodySchema } },
    async (request, reply) => {
    const body = /** @type {{
      type: import('../src/domain/backgroundTaskLock.js').BackgroundTaskType
      progress?: string
      meta?: Record<string, unknown>
    }} */ (request.body)
    const type = body.type
    const permissions =
      type === 'import'
        ? ['import']
        : type === 'pdf_export'
          ? ['export']
          : ['retag']
    if (!assertWritePermission(request, reply, permissions)) return
    const user = request.user
    if (!user?.id) {
      reply.code(401).send({ error: '未登录' })
      return
    }
    try {
      const result = acquireBackgroundTaskLock(type, {
        id: user.id,
        username: user.username,
        progress: body.progress,
        meta: body.meta,
      })
      logAuditFromRequest(request, 'storage.background_task_acquire', {
        type,
        lockId: result.lock.id,
        created: result.created,
      })
      return result
    } catch (err) {
      const e = /** @type {Error & { code?: string; lock?: unknown }} */ (err)
      if (e.code === 'BACKGROUND_TASK_CONFLICT') {
        reply.code(409).send({ error: e.message, lock: e.lock })
        return
      }
      throw err
    }
    },
  )

  app.patch(
    '/api/storage/background-task',
    { schema: { body: backgroundTaskTouchBodySchema } },
    async (request, reply) => {
    const body = /** @type {{ progress?: string; meta?: Record<string, unknown> }} */ (
      request.body
    )
    const user = request.user
    if (!user?.id) {
      reply.code(401).send({ error: '未登录' })
      return
    }
    try {
      const lock = touchBackgroundTaskLock(user.id, body)
      return { lock }
    } catch (err) {
      const e = /** @type {Error & { code?: string }} */ (err)
      if (e.code === 'BACKGROUND_TASK_FORBIDDEN') {
        reply.code(403).send({ error: e.message })
        return
      }
      if (e.message === '当前无进行中的后台任务') {
        reply.code(404).send({ error: e.message })
        return
      }
      throw err
    }
    },
  )

  app.delete('/api/storage/background-task', async (request, reply) => {
    const user = request.user
    if (!user?.id) {
      reply.code(401).send({ error: '未登录' })
      return
    }
    try {
      const released = releaseBackgroundTaskLock(user.id)
      if (!released) {
        reply.code(404).send({ error: '当前无进行中的后台任务' })
        return
      }
      logAuditFromRequest(request, 'storage.background_task_release', {})
      return { ok: true }
    } catch (err) {
      const e = /** @type {Error & { code?: string }} */ (err)
      if (e.code === 'BACKGROUND_TASK_FORBIDDEN') {
        reply.code(403).send({ error: e.message })
        return
      }
      throw err
    }
  })

  app.get('/api/storage/periods', { preHandler: requirePermission('view') }, async () => {
    return { periods: storageRepository.listInsightPeriods() }
  })

  app.put('/api/storage/periods', {
    preHandler: requirePermission('view'),
    schema: { body: periodPutBodySchema },
  }, async (request, reply) => {
    const body = /** @type {{ period: import('../src/domain/insightPeriod.js').InsightPeriod }} */ (
      request.body
    )
    if (!body.period?.id) {
      reply.code(400).send({ error: '缺少 period' })
      return
    }
    storageRepository.putInsightPeriod(body.period)
    return { ok: true }
  })

  app.get(
    '/api/storage/periods/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const period = storageRepository.getInsightPeriod(id)
      if (!period) {
        reply.code(404).send({ error: '周期不存在' })
        return
      }
      return { period }
    },
  )

  app.get('/api/storage/records', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {import('../src/storage/adapter.js').RecordQuery & { fields?: string }} */ (request.query || {})
    const fields = q.fields === 'list' ? 'list' : 'full'
    return storageRepository.listRecords({ ...q, fields })
  })

  app.get(
    '/api/storage/records/ticket-ids',
    { preHandler: requirePermission('view') },
    async (request) => {
      const q = /** @type {{ dataSourceType?: string } } */ (request.query || {})
      const dataSourceType = q.dataSourceType?.trim() || 'complaint_ticket'
      return { ticketIds: storageRepository.listTicketIdsBySourceType(dataSourceType) }
    },
  )

  app.get(
    '/api/storage/records/month-summary',
    { preHandler: requirePermission('view') },
    async (request) => {
      const q = /** @type {{ tenantId?: string } } */ (request.query || {})
      return storageRepository.listImportMonthSummary({ tenantId: q.tenantId })
    },
  )

  app.get(
    '/api/storage/records/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const record = storageRepository.getRecord(id)
      if (!record) {
        reply.code(404).send({ error: '记录不存在' })
        return
      }
      return { record }
    },
  )

  app.put('/api/storage/records', {
    schema: { body: recordsReplaceBodySchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import', 'editRecord'])) return
    const body = /** @type {{ records: import('../src/domain/records.js').InsightRecord[] }} */ (
      request.body
    )
    try {
      storageRepository.replaceAllRecords(body.records)
    } catch (err) {
      const e = /** @type {Error & { code?: string }} */ (err)
      if (e.code === TICKET_ID_CONFLICT_CODE) {
        reply.code(409).send({ error: e.message, code: TICKET_ID_CONFLICT_CODE })
        return
      }
      throw err
    }
    logAuditFromRequest(request, 'storage.replace_all_records', {
      count: body.records.length,
    })
    return { ok: true, count: body.records.length }
  })
  app.patch(
    '/api/storage/records/:id',
    { schema: { params: recordIdParamsSchema, body: recordPatchBodySchema } },
    async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import', 'editRecord'])) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    const body = /** @type {{
      record?: import('../src/domain/records.js').InsightRecord
      expectedRevision?: number
      forceOverwrite?: boolean
    }} */ (request.body || {})
    if (!body.record?.id || body.record.id !== id) {
      reply.code(400).send({ error: 'record.id 不匹配' })
      return
    }
    const user = request.user
    try {
      const result = storageRepository.putRecord(body.record, {
        expectedRevision: body.expectedRevision,
        actor: user?.id
          ? { userId: user.id, username: user.username || user.id }
          : null,
      })
      if (body.forceOverwrite === true) {
        logAuditFromRequest(request, 'storage.record_force_overwrite', {
          recordId: id,
          ticketId: body.record.ticketId ?? null,
          expectedRevision: body.expectedRevision ?? null,
          recordRevision: result.recordRevision,
        })
      }
      return { ok: true, recordRevision: result.recordRevision }
    } catch (err) {
      const e = /** @type {Error & { code?: string; current?: unknown; currentRevision?: number }} */ (
        err
      )
      if (e.code === 'RECORD_CONFLICT') {
        reply.code(409).send({
          error: e.message,
          code: 'RECORD_CONFLICT',
          current: e.current ?? null,
          currentRevision: e.currentRevision ?? 0,
        })
        return
      }
      if (e.code === TICKET_ID_CONFLICT_CODE) {
        reply.code(409).send({ error: e.message, code: TICKET_ID_CONFLICT_CODE })
        return
      }
      throw err
    }
  })

  app.post(
    '/api/storage/follow-up-satisfaction/import',
    { schema: { body: followUpSatisfactionImportBodySchema } },
    async (request, reply) => {
      if (!assertWritePermission(request, reply, ['import'])) return
      const body = /** @type {{
        importMonth: string
        insightPeriodId?: string
        importBatchId?: string
        dryRun?: boolean
        rows: Record<string, string>[]
      }} */ (request.body)

      const { processFollowUpSatisfactionImportRows, summarizeFollowUpImportResult } =
        await import('../../src/lib/followUpSatisfactionImport.js')

      const insightPeriodId = body.insightPeriodId?.trim() || undefined
      const period = insightPeriodId ? storageRepository.getInsightPeriod(insightPeriodId) : null
      const ticketRecords = storageRepository.listTicketRecordsForFollowUpImport()
      const result = processFollowUpSatisfactionImportRows(body.rows, ticketRecords, {
        importMonth: body.importMonth,
        importBatchId: body.importBatchId || `follow-up-${body.importMonth}-${Date.now()}`,
        importedAt: new Date().toISOString(),
        period,
      })
      const summary = summarizeFollowUpImportResult(result)
      const dryRun = body.dryRun === true

      if (!dryRun && result.updatedRecords.length) {
        storageRepository.putRecords(result.updatedRecords, {
          actor: request.user?.id
            ? { userId: request.user.id, username: request.user.username || request.user.id }
            : null,
        })
      }

      if (!dryRun) {
        logAuditFromRequest(request, 'follow_up_satisfaction.import', {
          importMonth: body.importMonth,
          insightPeriodId,
          appliedRowCount: summary.appliedRowCount,
          updatedRecordCount: summary.updatedRecordCount,
          unmatchedCount: summary.unmatched.length,
          skippedNotSuccessful: summary.skippedNotSuccessful,
          skippedInvalidScore: summary.skippedInvalidScore,
          outOfPeriodCount: summary.outOfPeriodCount,
          overwrittenCount: summary.overwrittenCount,
          idempotentUpdateCount: summary.idempotentUpdateCount,
        })
      }

      if (!dryRun && result.updatedRecords.length && insightPeriodId) {
        const { markPeriodSnapshotsStale } = await import(
          '../../src/snapshots/snapshotService.js'
        )
        const { createRepositoryStorageAdapter } = await import(
          '../repositoryStorageAdapter.js'
        )
        await markPeriodSnapshotsStale(createRepositoryStorageAdapter(), insightPeriodId)
      }

      return { ok: true, dryRun, ...summary }
    },
  )

  app.post(
    '/api/storage/records/batch',
    { schema: { body: recordsBatchBodySchema } },
    async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import', 'editRecord'])) return
    const body = /** @type {{ records: import('../src/domain/records.js').InsightRecord[] }} */ (
      request.body
    )
    const writeResult = storageRepository.putRecords(body.records, {
      actor: request.user?.id
        ? { userId: request.user.id, username: request.user.username || request.user.id }
        : null,
    })
    const sample = body.records[0]
    logAuditFromRequest(request, 'storage.import_batch', {
      count: writeResult?.written ?? body.records.length,
      skippedTicketConflicts: writeResult?.skippedTicketConflicts ?? 0,
      dataSourceType: sample?.dataSourceType,
      importMonth: sample?.importMonth,
      importBatchId: sample?.importBatchId,
    })
    return {
      ok: true,
      count: writeResult?.written ?? body.records.length,
      skippedTicketConflicts: writeResult?.skippedTicketConflicts ?? 0,
    }
    },
  )

  app.delete('/api/storage/records/:id', {
    schema: { params: recordIdParamsSchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import', 'editRecord'])) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    storageRepository.deleteRecord(id)
    logAuditFromRequest(request, 'storage.delete_record', { recordId: id })
    return { ok: true }
  })

  app.delete('/api/storage/imported-data', {
    schema: { querystring: clearImportedDataQuerySchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['deleteData'])) return
    const { parseClearImportedDataOptions, validateClearImportedDataOptions } = await import(
      '../../src/storage/clearImportedData.js'
    )
    const options = parseClearImportedDataOptions(/** @type {Record<string, unknown>} */ (request.query))
    const validationError = validateClearImportedDataOptions(options)
    if (validationError) {
      reply.code(400).send({ error: validationError })
      return
    }
    const cleared = storageRepository.clearImportedData(options)
    logAuditFromRequest(request, 'storage.clear_imported_data', {
      scope: options.all ? 'all' : 'filtered',
      insightPeriodId: options.insightPeriodId || undefined,
      dataSourceType: options.dataSourceType || undefined,
      product: options.product || undefined,
      ...cleared,
    })
    return { ok: true, ...cleared }
  })

  app.get('/api/storage/runs', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {{ insightPeriodId?: string; dataSourceType?: string }} */ (request.query || {})
    if (!q.insightPeriodId) return { runs: [] }
    return {
      runs: storageRepository.listAnalysisRuns(q.insightPeriodId, q.dataSourceType),
    }
  })

  app.get(
    '/api/storage/runs/by-idempotency',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const q = /** @type {{ key?: string }} */ (request.query || {})
      const key = q.key?.trim()
      if (!key) {
        reply.code(400).send({ error: '缺少 key 参数' })
        return
      }
      return { run: storageRepository.findRunByIdempotencyKey(key) }
    },
  )

  app.get(
    '/api/storage/runs/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const run = storageRepository.getAnalysisRun(id)
      if (!run) {
        reply.code(404).send({ error: '运行记录不存在' })
        return
      }
      return { run }
    },
  )

  app.put('/api/storage/runs', {
    schema: { body: runPutBodySchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import'])) return
    const body = /** @type {{ run: import('../src/domain/analysisRun.js').AnalysisRun }} */ (
      request.body
    )
    if (!body.run?.id) {
      reply.code(400).send({ error: '缺少 run' })
      return
    }
    storageRepository.putAnalysisRun(body.run)
    return { ok: true }
  })

  app.get('/api/storage/artifacts', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {{ runId?: string; debug?: string }} */ (request.query || {})
    if (!q.runId) return { artifacts: [] }
    return {
      artifacts: storageRepository.listArtifactsByRun(q.runId, q.debug === '1' || q.debug === 'true'),
    }
  })

  app.put('/api/storage/artifacts', {
    schema: { body: artifactPutBodySchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import'])) return
    const body = /** @type {{
      artifact: import('../src/domain/analysisRun.js').RecordArtifact | import('../src/domain/analysisRun.js').RunArtifact
      debug?: boolean
    }} */ (request.body)
    if (!body.artifact?.id) {
      reply.code(400).send({ error: '缺少 artifact' })
      return
    }
    storageRepository.putArtifact(body.artifact, Boolean(body.debug))
    return { ok: true }
  })

  app.get('/api/storage/snapshots', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {{ insightPeriodId?: string }} */ (request.query || {})
    if (!q.insightPeriodId) return { snapshots: [] }
    return { snapshots: storageRepository.listSnapshotsByPeriod(q.insightPeriodId) }
  })

  app.get(
    '/api/storage/snapshots/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const snapshot = storageRepository.getSnapshot(decodeURIComponent(id))
      if (!snapshot) {
        reply.code(404).send({ error: '快照不存在' })
        return
      }
      return { snapshot }
    },
  )

  app.put('/api/storage/snapshots', {
    schema: { body: snapshotPutBodySchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import', 'editRecord'])) return
    const body = /** @type {{
      snapshot: import('../src/domain/snapshot.js').InsightSnapshot | import('../src/domain/snapshot.js').OverviewSnapshot
    }} */ (request.body)
    if (!body.snapshot?.id) {
      reply.code(400).send({ error: '缺少 snapshot' })
      return
    }
    storageRepository.putSnapshot(body.snapshot)
    return { ok: true }
  })

  app.post(
    '/api/storage/insight-rebuild',
    { schema: { body: insightRebuildBodySchema } },
    async (request, reply) => {
    if (!assertWritePermission(request, reply, ['import', 'editRecord'])) return
    const body = /** @type {{ insightPeriodId: string }} */ (request.body)
    const insightPeriodId = body.insightPeriodId.trim()
    try {
      const result = await enqueueInsightRebuild(insightPeriodId, request.user?.username)
      logAuditFromRequest(request, 'storage.insight_rebuild_enqueue', {
        jobId: result.job.id,
        insightPeriodId,
        started: result.started,
      })
      return result
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
    },
  )

  app.get('/api/storage/insight-rebuild', { preHandler: requirePermission('view') }, async (request, reply) => {
    const q = /** @type {{ insightPeriodId?: string; limit?: string }} */ (request.query || {})
    const insightPeriodId = q.insightPeriodId?.trim()
    if (!insightPeriodId) {
      reply.code(400).send({ error: '缺少 insightPeriodId' })
      return
    }
    const limit = Math.min(20, Math.max(1, Number(q.limit) || 5))
    return { jobs: listInsightRebuildJobsForPeriod(insightPeriodId, limit) }
  })

  app.get(
    '/api/storage/insight-rebuild/:id',
    { preHandler: requirePermission('view') },
    async (request, reply) => {
      const { id } = /** @type {{ id: string }} */ (request.params)
      const job = getInsightRebuildJob(decodeURIComponent(id))
      if (!job) {
        reply.code(404).send({ error: '重建任务不存在' })
        return
      }
      return { job }
    },
  )

  app.get(
    '/api/storage/meta/:key',
    {
      preHandler: requirePermission('view'),
      schema: { params: metaKeyParamsSchema },
    },
    async (request) => {
      const { key } = /** @type {{ key: string }} */ (request.params)
      const decodedKey = decodeURIComponent(key)
      if (decodedKey === 'taxonomy_managed') {
        return { value: readTaxonomyManagedMetaHydrated() }
      }
      return { value: storageRepository.getMeta(decodedKey) }
    },
  )

  app.put('/api/storage/meta/:key', {
    schema: { params: metaKeyParamsSchema, body: metaPutBodySchema },
  }, async (request, reply) => {
    const { key } = /** @type {{ key: string }} */ (request.params)
    const decodedKey = decodeURIComponent(key)
    const tagMetaKeys = ['taxonomy_managed', 'taxonomy_overrides', 'tag_library_version', 'product_catalog_managed_v1']
    const perms = []
    if (tagMetaKeys.includes(decodedKey)) perms.push('manageTags')
    else if (decodedKey === 'product_order_volumes_v1' || decodedKey === 'wan_tou_targets_v1') {
      perms.push('editOrderVolumes')
    }
    else if (decodedKey === 'app_settings_shared_v1' || decodedKey === 'recommendation_feedback_v1') {
      perms.push('manageTeamSettings')
    } else perms.push('view')
    if (!assertWritePermission(request, reply, perms)) return
    const body = /** @type {{ value?: unknown }} */ (request.body || {})
    storageRepository.putMeta(decodedKey, body.value ?? null)
    if (tagMetaKeys.includes(decodedKey) || decodedKey === 'product_catalog_managed_v1') {
      bumpDataRevision()
    }
    if (decodedKey === 'taxonomy_managed' || decodedKey === 'product_catalog_managed_v1') {
      scheduleConfigAutoPublish(decodedKey, request.user?.username)
    }
    return { ok: true }
  })

  app.get('/api/storage/tag-candidates', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {{ status?: string; tagType?: string }} */ (request.query || {})
    return { candidates: storageRepository.listTagCandidates(q) }
  })

  app.put('/api/storage/tag-candidates', {
    schema: { body: tagCandidatesPutBodySchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['manageTags'])) return
    const body = /** @type {{
      candidate?: import('../src/domain/tagCandidate.js').TagCandidate
      candidates?: import('../src/domain/tagCandidate.js').TagCandidate[]
    }} */ (request.body)
    if (body.candidates?.length) {
      storageRepository.putTagCandidates(body.candidates)
      return { ok: true, count: body.candidates.length }
    }
    if (body.candidate?.id) {
      storageRepository.putTagCandidate(body.candidate)
      return { ok: true }
    }
    reply.code(400).send({ error: '缺少 candidate 或 candidates' })
  })

  app.delete('/api/storage/tag-candidates/:id', {
    schema: { params: tagCandidateIdParamsSchema },
  }, async (request, reply) => {
    if (!assertWritePermission(request, reply, ['manageTags'])) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    storageRepository.deleteTagCandidate(id)
    return { ok: true }
  })

  app.get(
    '/api/storage/taxonomy/publish-status',
    { preHandler: requirePermission('view') },
    async () => getTaxonomyPublishStatus(),
  )

  app.post('/api/storage/taxonomy/publish', async (request, reply) => {
    if (!assertWritePermission(request, reply, ['manageTags'])) return
    const body = /** @type {{ writeJson?: boolean }} */ (request.body || {})
    try {
      const result = publishTaxonomyToFiles({
        writeJson: body.writeJson !== false,
        publishedBy: request.user?.username || 'unknown',
      })
      logAuditFromRequest(request, 'storage.publish_taxonomy', {
        excelPath: result.excelPath,
        jsonFiles: result.jsonFiles?.length,
      })
      return result
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.get(
    '/api/storage/product-catalog/publish-status',
    { preHandler: requirePermission('view') },
    async () => getProductCatalogPublishStatus(),
  )

  app.post('/api/storage/product-catalog/publish', async (request, reply) => {
    if (!assertWritePermission(request, reply, ['manageTags'])) return
    const body = /** @type {{ writeJson?: boolean }} */ (request.body || {})
    try {
      const result = publishProductCatalogToFiles({
        writeJson: body.writeJson !== false,
        publishedBy: request.user?.username || 'unknown',
      })
      logAuditFromRequest(request, 'storage.publish_product_catalog', {
        excelPath: result.excelPath,
        jsonPath: result.jsonPath,
        productCount: result.stats?.products,
      })
      return result
    } catch (err) {
      reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
    }
  })

  app.post(
    '/api/storage/bootstrap-from-local',
    { preHandler: [requirePermission('import'), requireAdmin()] },
    async (request, reply) => {
      const body = /** @type {Parameters<typeof storageRepository.bootstrapFromLocal>[0]} */ (
        request.body || {}
      )
      try {
        const result = storageRepository.bootstrapFromLocal(body)
        logAuditFromRequest(request, 'storage.bootstrap_from_local', result)
        return { ok: true, ...result }
      } catch (err) {
        reply.code(400).send({ error: err instanceof Error ? err.message : String(err) })
      }
    },
  )
}
