import { requirePermission } from '../middleware.js'
import { hasPermission } from '../../src/domain/auth/permissions.js'
import { logAuditFromRequest } from '../audit.js'
import { META_KEY_POST_USE_VISITS } from '../../src/lib/postUseRating/visitRecords.js'
import { storageRepository } from '../storageRepository.js'
import { deleteAttachmentsForOwner } from '../postUseAttachmentRepository.js'
import { normalizePostUseActionIds, withPostUseActionIds } from '../../src/domain/postUseActions.js'

/** @param {import('fastify').FastifyRequest} request */
function assertEditRecordPermission(request, reply) {
  const user = request.user
  if (!user) {
    reply.code(401).send({ error: '未登录' })
    return false
  }
  if (!hasPermission(user.role, 'editRecord')) {
    reply.code(403).send({ error: '无权限执行此操作' })
    return false
  }
  return true
}

/**
 * meta 整包 read-modify-write，包内每条记录独立 updatedAt。
 * @param {string} id
 * @param {(record: any) => any | null} mutator
 * @returns {{ ok: boolean, record: null | any, changed?: boolean, reason?: 'not_found' | 'conflict' }}
 */
function mutateVisitRecord(id, mutator) {
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const recordList = Array.isArray(raw?.records) ? raw.records : []
  const idx = recordList.findIndex((item) => String(item?.id || '') === String(id))
  if (idx < 0) return { ok: false, record: null, reason: 'not_found' }
  const next = [...recordList]
  const updated = mutator(next[idx])
  if (updated === null) return { ok: false, record: null, reason: 'conflict' }
  if (updated === next[idx]) return { ok: true, record: next[idx], changed: false }
  next[idx] = updated
  storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
    ...raw,
    updatedAt: new Date().toISOString(),
    records: next,
  })
  return { ok: true, record: next[idx], changed: true }
}

/**
 * 编辑回访后，把 records 表中挂接该回访的 customerVisit 快照同步更新。
 * 匹配：数据月份 + 产品 + 客户（编码/名称），且快照当前内部评估/备注与编辑前旧值一致
 * （旧值一致才回写，避免误伤同客户多条不同挂接）。
 * @param {any} before 编辑前回访记录
 * @param {any} after 编辑后回访记录
 * @returns {number} 回写条数
 */
function syncCustomerVisitSnapshots(before, after) {
  const visitMonth = String(before?.visitMonth || '')
  const month = String(before?.importMonth || visitMonth || '')
  const productName = String(before?.productName || '').trim()
  const customerCode = String(before?.customerCode || '').trim()
  const customerName = String(before?.customerName || '').trim()
  const oldEvaluation = String(before?.internalEvaluationDetail || before?.internalConclusion || '')
  const oldRemark = String(before?.remark || '')
  if (!month || !productName) return 0
  // 双空守卫：编辑前评估与备注均为空时，空字符串对「月+产品+客户+旧内容」
  // 匹配零区分力，会批量误伤同月同产品同客户的所有空快照（无挂接关系的记录
  // 也会被写入）。空快照的更新走重新导入的主路径，不做编辑回写。
  if (!oldEvaluation && !oldRemark) return 0

  const list = storageRepository.listRecords({
    dataSourceTypes: ['post_use_rating'],
    limit: 100000,
  })
  const candidates = (list?.records || []).filter((record) => {
    const cv = record?.customerVisit
    if (!cv || typeof cv !== 'object') return false
    const cvMonth = String(cv.importMonth || cv.visitMonth || '')
    if (cvMonth !== month) return false
    if (String(cv.productName || '').trim() !== productName) return false
    if (customerCode && String(cv.customerCode || '').trim() !== customerCode) return false
    if (!customerCode && customerName && String(cv.customerName || '').trim() !== customerName) return false
    const cvEvaluation = String(cv.internalEvaluationDetail || cv.internalConclusion || '')
    const cvRemark = String(cv.remark || '')
    return cvEvaluation === oldEvaluation && cvRemark === oldRemark
  })

  for (const record of candidates) {
    storageRepository.putRecord({
      ...record,
      customerVisit: {
        ...record.customerVisit,
        internalEvaluationDetail: after.internalEvaluationDetail || '',
        internalConclusion: after.internalConclusion || '',
        remark: after.remark || '',
      },
    })
  }
  return candidates.length
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerPostUseVisitRoutes(app) {
  app.get('/api/post-use-visits', { preHandler: requirePermission('view') }, async (request) => {
    const q = /** @type {Record<string, string>} */ (request.query || {})
    const months = String(q.importMonth || '')
      .split('、')
      .map((m) => m.trim())
      .filter(Boolean)
    const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
    /** @type {any[]} */
    let records = Array.isArray(raw?.records) ? raw.records : []
    if (months.length) {
      const monthSet = new Set(months)
      records = records.filter((r) => monthSet.has(r?.importMonth || r?.visitMonth))
    }
    return { items: records.map((record) =>
      withPostUseActionIds(record, normalizePostUseActionIds(record.actionIds, record.actionId))) }
  })

  // 2026-11-05 状态派生链路：evaluationSubmitted 标记评估是否完结提交（暂存=false / 提交=true）；
  // 评估状态 = 评估空→待评估、非空未提交→评估中、已提交→已评估（提醒引擎与列表派生同口径）。
  // 按实际变化记录人工编辑域。清空也是人工编辑；未变化的表单值不应占用导入保护。
  app.patch('/api/post-use-visits/:id', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    const body = /** @type {{ internalEvaluationDetail?: string, internalConclusion?: string, remark?: string, assigneeName?: string, actionId?: string, evaluationSubmitted?: boolean, baseUpdatedAt?: string }} */ (
      request.body || {}
    )

    /** @type {any} */
    let before = null
    const result = mutateVisitRecord(id, (record) => {
      const baseUpdatedAt = String(body.baseUpdatedAt || '').trim()
      if (baseUpdatedAt && String(record?.updatedAt || '') !== baseUpdatedAt) {
        return null
      }
      before = record
      const now = new Date().toISOString()
      const next = { ...record }
      const manualEdited = new Set(Array.isArray(record?.manualEditedFields) ? record.manualEditedFields : [])
      const editInfo = { ...(record?.fieldEditMeta || {}) }
      const editor = {
        userId: request.user.id,
        username: request.user.username,
        displayName: request.user.displayName || '',
        editedAt: now,
      }
      let changed = false
      const evaluation = typeof body.internalEvaluationDetail === 'string'
        ? body.internalEvaluationDetail
        : typeof body.internalConclusion === 'string' ? body.internalConclusion : null
      if (evaluation !== null) {
        const previous = String(record?.internalEvaluationDetail || record?.internalConclusion || '')
        next.internalEvaluationDetail = evaluation
        next.internalConclusion = evaluation
        if (evaluation !== previous) {
          manualEdited.add('internalEvaluation')
          editInfo.internalEvaluation = editor
          changed = true
        }
      }
      if (typeof body.evaluationSubmitted === 'boolean') {
        next.evaluationSubmitted = body.evaluationSubmitted
        if (body.evaluationSubmitted !== Boolean(record?.evaluationSubmitted)) {
          manualEdited.add('internalEvaluation')
          editInfo.internalEvaluation = editor
          changed = true
        }
      }
      for (const field of ['remark', 'assigneeName']) {
        if (typeof body[field] !== 'string') continue
        if (body[field] === String(record?.[field] || '')) continue
        next[field] = body[field]
        manualEdited.add(field)
        editInfo[field] = editor
        changed = true
      }
      // 旧单条接口继续可用；新抽屉通过增量接口维护多条关联。
      if (typeof body.actionId === 'string') {
        const currentIds = normalizePostUseActionIds(record.actionIds, record.actionId)
        const replacement = body.actionId.trim()
        const nextIds = replacement
          ? [replacement, ...currentIds.slice(1).filter((id) => id !== replacement)]
          : currentIds.slice(1)
        if (nextIds.join('\0') !== currentIds.join('\0')) {
          Object.assign(next, withPostUseActionIds(next, nextIds))
          manualEdited.add('actionIds')
          manualEdited.add('actionId')
          editInfo.actionIds = editor
          editInfo.actionId = editor
          changed = true
        }
      }
      if (!changed) return record
      next.manualEditedFields = [...manualEdited]
      next.fieldEditMeta = editInfo
      next.updatedAt = now
      return next
    })

    if (result.reason === 'conflict') {
      reply.code(409)
      return { error: '记录已被他人更新，请刷新后重试' }
    }
    if (!result.ok) {
      reply.code(404)
      return { error: '记录不存在' }
    }

    // 第二批：编辑后同步回写 records 表挂接的 customerVisit 快照
    let syncedSnapshots = 0
    try {
      if (result.changed) syncedSnapshots = syncCustomerVisitSnapshots(before, result.record)
    } catch (err) {
      request.log.warn({ err, visitId: id }, 'post_use_visit snapshot sync failed')
    }

    logAuditFromRequest(request, 'post_use_visit.update', {
      id,
      fields: Object.keys(body).filter((k) => k !== 'baseUpdatedAt'),
      syncedSnapshots,
    })
    return { item: result.record, syncedSnapshots }
  })

  // 2026-11-10 需求（用户拍板）：建议回访清单勾选行导出/发送成功 → 同步写入回访 tab（预导入态）。
  // visitResult/内部评估/经办人 初始为空（待后续导入补充）；身份键 = stableVisitRecordId(月,产品,客户)
  // 与导入链一致 → 后续导入按同身份覆盖更新（人工域保护自动生效）。幂等：同身份已存在则跳过（不覆盖）。
  app.post('/api/post-use-visits/batch', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const body = /** @type {{ items?: Array<{ visitMonth?: string, productName?: string, customerName?: string, customerCode?: string, customerFeedback?: string }> }} */ (
      request.body || {}
    )
    const items = Array.isArray(body.items) ? body.items : []
    if (!items.length) {
      reply.code(400)
      return { error: '请至少提交一条记录' }
    }

    const { stableVisitRecordId, buildCustomerKey } = await import(
      '../../src/lib/postUseRating/customerVisitImport.js'
    )
    const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
    const recordList = Array.isArray(raw?.records) ? raw.records : []
    const now = new Date().toISOString()
    /** @type {any[]} */
    const created = []
    const nextRecords = [...recordList]
    for (const rawItem of items) {
      const visitMonth = String(rawItem?.visitMonth || '').trim()
      const productName = String(rawItem?.productName || '').trim()
      const customerName = String(rawItem?.customerName || '').trim()
      const customerCode = String(rawItem?.customerCode || '').trim()
      if (!visitMonth || !productName || (!customerName && !customerCode)) continue
      const customerKey = buildCustomerKey({ customerName, customerCode })
      const id = stableVisitRecordId(visitMonth, productName, customerKey)
      // 幂等按身份三元组判定（非 id）：老记录 id 可能是字符串（导入链早期形态）而与
      // stableId 不同——只查 id 会漏判同身份（测试实测暴露），按 月+产品+客户键 查重
      const sameIdentity = nextRecords.some(
        (record) =>
          String(record?.importMonth || record?.visitMonth || '') === visitMonth &&
          String(record?.productName || '') === productName &&
          buildCustomerKey(record) === customerKey,
      )
      if (sameIdentity) continue
      const record = {
        id,
        visitMonth,
        importMonth: visitMonth,
        productName,
        customerName,
        customerCode,
        groupName: '',
        loginAccountName: '',
        originalTicketId: '',
        feedbackSummary: '',
        // 2026-11-10 拍板：客户反馈列带入清单行的客户反馈内容（与导出待省代表回访表同款文本）；
        // 后续导入同身份时按导入值覆盖（非人工编辑域，导入值优先语义自动成立）
        userFeedbackText: String(rawItem?.customerFeedback || '').trim(),
        assigneeName: '',
        scoreSource: '',
        ratingText: '',
        userInfo: [customerName, customerCode].filter(Boolean).join(' / '),
        userInfoDetail: [customerName, customerCode].filter(Boolean).join(' / '),
        visitResult: '',
        visitFeedbackDetail: '',
        internalConclusion: '',
        internalEvaluationDetail: '',
        evaluationSubmitted: false,
        remark: '',
        jiraId: '',
        dispatchPreloadedAt: now,
        updatedAt: now,
      }
      nextRecords.push(record)
      created.push(record)
    }
    if (created.length) {
      storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
        ...raw,
        updatedAt: now,
        records: nextRecords,
      })
    }
    logAuditFromRequest(request, 'post_use_visit.batch_preload', {
      requested: items.length,
      created: created.length,
    })
    return { created: created.map((record) => record.id), items: created }
  })

  // 2026-11-10 需求③（用户拍板，常驻功能）：删除回访记录（权限对齐产品部回溯 tab = editRecord）。
  // 联动（生命周期联动纪律——删除源实体时派生状态同步清理）：
  //   ① records 表挂接的 customerVisit 快照摘除（防幽灵挂载）
  //   ② 建议回访清单"已纳入"dispatch 标记删除（清单恢复勾选模式）
  //   ③ decisions 勾选 needCustomerVisit 重置为 false（恢复未勾选态）
  app.delete('/api/post-use-visits/:id', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const { id } = /** @type {{ id: string }} */ (request.params)

    const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
    const recordList = Array.isArray(raw?.records) ? raw.records : []
    const target = recordList.find((item) => String(item?.id || '') === String(id))
    if (!target) {
      reply.code(404)
      return { error: '记录不存在' }
    }

    const nextRecords = recordList.filter((item) => String(item?.id || '') !== String(id))
    storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
      ...raw,
      updatedAt: new Date().toISOString(),
      records: nextRecords,
    })

    const month = String(target.importMonth || target.visitMonth || '')
    const productName = String(target.productName || '').trim()
    const customerCode = String(target.customerCode || '').trim()
    const customerName = String(target.customerName || '').trim()

    // 联动 ①：摘除 records 表挂接的该回访快照（匹配：月+产品+客户）
    let detached = 0
    if (month && productName) {
      const list = storageRepository.listRecords({
        dataSourceTypes: ['post_use_rating'],
        limit: 100000,
      })
      const candidates = (list?.records || []).filter((record) => {
        const cv = record?.customerVisit
        if (!cv || typeof cv !== 'object') return false
        if (String(cv.importMonth || cv.visitMonth || '') !== month) return false
        if (String(cv.productName || '').trim() !== productName) return false
        if (customerCode && String(cv.customerCode || '').trim() !== customerCode) return false
        if (!customerCode && customerName && String(cv.customerName || '').trim() !== customerName) return false
        return true
      })
      for (const record of candidates) {
        const { customerVisit: _removed, ...rest } = record
        storageRepository.putRecord(rest)
        detached += 1
      }
    }

    // 联动 ②③：清单 dispatch 标记清理 + decisions 勾选重置
    // 2026-11-10 复盘补丁：联动失败错误外显（linkageError）而非只 log——吞错会让
    // "联动不生效"表现为成功响应里的 0（本次测试踩坑：解构 undefined 被吞成 cleared=0）
    let clearedDispatch = 0
    let clearedDecisions = 0
    let linkageError = null
    try {
      const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
      clearedDecisions = postUseJiraRepository.clearVisitDecisionsForDeletedVisit({ month, productName, customerCode, customerName })
      const { postUseVisitDispatchRepository } = await import('../postUseVisitDispatchRepository.js')
      clearedDispatch = postUseVisitDispatchRepository.deleteByIdentity({ month, productName, customerCode, customerName })
    } catch (err) {
      linkageError = String(err?.message || err)
      request.log.warn({ err, visitId: id }, 'post_use_visit delete linkage failed')
    }
    try {
      deleteAttachmentsForOwner('visit', id)
    } catch (err) {
      linkageError = [linkageError, '附件清理失败：' + String(err?.message || err)].filter(Boolean).join('；')
      request.log.warn({ err, visitId: id }, 'post_use_visit attachment cleanup failed')
    }

    logAuditFromRequest(request, 'post_use_visit.delete', {
      id,
      month,
      productName,
      customer: customerCode || customerName,
      detachedSnapshots: detached,
      clearedDispatch,
      clearedDecisions,
      linkageError,
    })
    return { ok: true, id, detached, clearedDispatch, clearedDecisions, linkageError }
  })

  // 批量删除（2026-11-10 用户拍板：与产品部回溯 tab 同款批量操作；单行删除按钮已去除）
  app.post('/api/post-use-visits/batch-delete', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const body = /** @type {{ ids?: string[] }} */ (request.body || {})
    const ids = Array.isArray(body.ids) ? body.ids.map((id) => String(id || '').trim()).filter(Boolean) : []
    if (!ids.length) {
      reply.code(400)
      return { error: '请选择要删除的记录' }
    }

    const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
    const recordList = Array.isArray(raw?.records) ? raw.records : []
    const targets = recordList.filter((item) => ids.includes(String(item?.id || '')))
    if (!targets.length) {
      reply.code(404)
      return { error: '记录不存在' }
    }

    const idSet = new Set(targets.map((item) => String(item?.id || '')))
    storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
      ...raw,
      updatedAt: new Date().toISOString(),
      records: recordList.filter((item) => !idSet.has(String(item?.id || ''))),
    })

    let detached = 0
    let clearedDispatch = 0
    let clearedDecisions = 0
    let linkageError = null
    try {
      const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
      const { postUseVisitDispatchRepository } = await import('../postUseVisitDispatchRepository.js')
      for (const target of targets) {
        const month = String(target.importMonth || target.visitMonth || '')
        const productName = String(target.productName || '').trim()
        const customerCode = String(target.customerCode || '').trim()
        const customerName = String(target.customerName || '').trim()
        if (month && productName) {
          const recList = storageRepository.listRecords({
            dataSourceTypes: ['post_use_rating'],
            limit: 100000,
          })
          const candidates = (recList?.records || []).filter((record) => {
            const cv = record?.customerVisit
            if (!cv || typeof cv !== 'object') return false
            if (String(cv.importMonth || cv.visitMonth || '') !== month) return false
            if (String(cv.productName || '').trim() !== productName) return false
            if (customerCode && String(cv.customerCode || '').trim() !== customerCode) return false
            if (!customerCode && customerName && String(cv.customerName || '').trim() !== customerName) return false
            return true
          })
          for (const record of candidates) {
            const { customerVisit: _removed, ...rest } = record
            storageRepository.putRecord(rest)
            detached += 1
          }
        }
        clearedDecisions += postUseJiraRepository.clearVisitDecisionsForDeletedVisit({ month, productName, customerCode, customerName })
        clearedDispatch += postUseVisitDispatchRepository.deleteByIdentity({ month, productName, customerCode, customerName })
      }
    } catch (err) {
      linkageError = String(err?.message || err)
      request.log.warn({ err }, 'post_use_visit batch delete linkage failed')
    }
    for (const target of targets) {
      try {
        deleteAttachmentsForOwner('visit', String(target.id))
      } catch (err) {
        linkageError = [linkageError, '附件清理失败：' + String(err?.message || err)].filter(Boolean).join('；')
        request.log.warn({ err, visitId: target.id }, 'post_use_visit batch attachment cleanup failed')
      }
    }

    logAuditFromRequest(request, 'post_use_visit.batch_delete', {
      count: targets.length,
      detachedSnapshots: detached,
      clearedDispatch,
      clearedDecisions,
      linkageError,
    })
    return { deleted: targets.length, detached, clearedDispatch, clearedDecisions, linkageError }
  })
}
