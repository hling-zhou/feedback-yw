import { requirePermission } from '../middleware.js'
import { hasPermission } from '../../src/domain/auth/permissions.js'
import { logAuditFromRequest } from '../audit.js'
import { META_KEY_POST_USE_VISITS } from '../../src/lib/postUseRating/visitRecords.js'
import { storageRepository } from '../storageRepository.js'

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
 * @param {(record: any) => any} mutator
 * @returns {{ ok: boolean, record: null | any, reason?: 'not_found' }}
 */
function mutateVisitRecord(id, mutator) {
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  const recordList = Array.isArray(raw?.records) ? raw.records : []
  const idx = recordList.findIndex((item) => String(item?.id || '') === String(id))
  if (idx < 0) return { ok: false, record: null, reason: 'not_found' }
  const next = [...recordList]
  next[idx] = mutator(next[idx])
  storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
    ...raw,
    updatedAt: new Date().toISOString(),
    records: next,
  })
  return { ok: true, record: next[idx] }
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
    return { items: records }
  })

  app.patch('/api/post-use-visits/:id', async (request, reply) => {
    if (!assertEditRecordPermission(request, reply)) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    const body = /** @type {{ internalEvaluationDetail?: string, internalConclusion?: string, remark?: string, assigneeName?: string, actionId?: string, baseUpdatedAt?: string }} */ (
      request.body || {}
    )

    /** @type {null | { conflict: true } | { error: string }} */
    let thrown = null
    /** @type {any} */
    let before = null
    const result = mutateVisitRecord(id, (record) => {
      const baseUpdatedAt = String(body.baseUpdatedAt || '').trim()
      if (baseUpdatedAt && String(record?.updatedAt || '') !== baseUpdatedAt) {
        thrown = { conflict: true }
        return record
      }
      before = record
      const now = new Date().toISOString()
      const next = { ...record }
      if (typeof body.internalEvaluationDetail === 'string') {
        next.internalEvaluationDetail = body.internalEvaluationDetail
        next.internalConclusion = body.internalEvaluationDetail
      }
      if (typeof body.internalConclusion === 'string') {
        next.internalConclusion = body.internalConclusion
        if (typeof body.internalEvaluationDetail !== 'string') {
          next.internalEvaluationDetail = body.internalConclusion
        }
      }
      if (typeof body.remark === 'string') next.remark = body.remark
      if (typeof body.assigneeName === 'string') next.assigneeName = body.assigneeName
      if (typeof body.actionId === 'string') next.actionId = body.actionId
      next.updatedAt = now
      return next
    })

    if (thrown?.conflict) {
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
      syncedSnapshots = syncCustomerVisitSnapshots(before, result.record)
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
}
