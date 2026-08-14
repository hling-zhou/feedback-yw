import { requireAdmin, requirePermission } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { getDb } from '../db.js'
import { storageRepository } from '../storageRepository.js'
import { complaintCauseReviewArchiveRepository } from '../complaintCauseReviewArchiveRepository.js'
import {
  applyComplaintCauseReviewDecisionToRecord,
  buildComplaintCauseReviewArchiveRow,
} from '../../src/domain/complaintCauseReviewArchive.js'
import { isComplaintTicket } from '../../src/domain/complaintCause.js'
import {
  hasPendingComplaintCauseReview,
  isCompleteComplaintCauseReview,
} from '../../src/domain/complaintCauseReview.js'

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerComplaintCauseReviewRoutes(app) {
  app.get(
    '/api/complaint-cause-review/archive',
    { preHandler: [requirePermission('view'), requireAdmin()] },
    async () => ({ items: complaintCauseReviewArchiveRepository.listAll() }),
  )

  app.post(
    '/api/complaint-cause-review/apply',
    { preHandler: [requirePermission('view'), requireAdmin()] },
    async (request, reply) => {
      const body = /** @type {{ items?: { recordId?: string; decision?: string }[] }} */ (
        request.body || {}
      )
      const items = Array.isArray(body.items) ? body.items : []
      if (!items.length) {
        reply.code(400)
        return { error: '请至少提交一条复核结果' }
      }

      const actor = {
        userId: request.user?.id || '',
        username: request.user?.username || '',
      }
      const decidedAt = new Date().toISOString()
      /** @type {import('../../src/domain/complaintCauseReviewArchive.js').ComplaintCauseReviewArchiveRow[]} */
      const archives = []
      /** @type {import('../../src/domain/records.js').InsightRecord[]} */
      const updatedRecords = []
      const errors = []
      const db = getDb()
      const applyOne = db.transaction((archive, next) => {
        complaintCauseReviewArchiveRepository.insert(archive)
        return storageRepository.putRecord(next, { actor })
      })

      for (const item of items) {
        const recordId = String(item?.recordId || '').trim()
        const decision = String(item?.decision || '').trim()
        if (!recordId || (decision !== 'agree' && decision !== 'reject')) {
          errors.push({ recordId, error: '复核结果无效' })
          continue
        }
        const record = storageRepository.getRecord(recordId)
        if (!record) {
          errors.push({ recordId, error: '工单不存在' })
          continue
        }
        if (!isComplaintTicket(record)) {
          errors.push({ recordId, error: '非投诉工单' })
          continue
        }
        if (!hasPendingComplaintCauseReview(record)) {
          errors.push({ recordId, error: '无待复核内容' })
          continue
        }
        if (!isCompleteComplaintCauseReview(record)) {
          errors.push({ recordId, error: '拟复核不完整' })
          continue
        }

        const archive = buildComplaintCauseReviewArchiveRow(
          record,
          /** @type {'agree' | 'reject'} */ (decision),
          actor,
          decidedAt,
        )
        const next = applyComplaintCauseReviewDecisionToRecord(
          record,
          /** @type {'agree' | 'reject'} */ (decision),
        )
        try {
          const result = applyOne(archive, next)
          archives.push(archive)
          updatedRecords.push(result.record)
        } catch (err) {
          errors.push({
            recordId,
            error: err instanceof Error ? err.message : '保存失败',
          })
        }
      }

      logAuditFromRequest(request, 'complaint_cause_review.apply', {
        appliedCount: archives.length,
        agreeCount: archives.filter((row) => row.decision === 'agree').length,
        rejectCount: archives.filter((row) => row.decision === 'reject').length,
        errorCount: errors.length,
      })
      return {
        ok: errors.length === 0,
        appliedCount: archives.length,
        archives,
        updatedRecords,
        errors,
      }
    },
  )
}
