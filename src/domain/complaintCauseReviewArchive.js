/**
 * 投诉原因复核归档与审批应用（纯函数 + 行模型）。
 */

import {
  clearComplaintCauseReviewFields,
  isCompleteComplaintCauseReview,
} from './complaintCauseReview.js'
import { getManualTagFields } from '../lib/manualTagFields.js'

/** @typedef {'agree' | 'reject'} ComplaintCauseReviewDecision */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * @typedef {Object} ComplaintCauseReviewArchiveRow
 * @property {string} id
 * @property {string} recordId
 * @property {string} ticketId
 * @property {string} product
 * @property {string} originalL1
 * @property {string} originalL2
 * @property {string} originalL3
 * @property {string} reviewL1
 * @property {string} reviewL2
 * @property {string} reviewL3
 * @property {string} reason
 * @property {ComplaintCauseReviewDecision} decision
 * @property {string} decidedAt
 * @property {string} decidedByUserId
 * @property {string} decidedByUsername
 */

/**
 * 管理员复核清单 / apply：仅完整拟复核。
 * @param {FeedbackRecord | null | undefined} record
 */
export function isComplaintCauseReviewPending(record) {
  return isCompleteComplaintCauseReview(record)
}

/**
 * @param {FeedbackRecord} record
 * @param {ComplaintCauseReviewDecision} decision
 * @param {{ userId?: string; username?: string }} actor
 * @param {string} [decidedAt]
 * @returns {ComplaintCauseReviewArchiveRow}
 */
export function buildComplaintCauseReviewArchiveRow(record, decision, actor = {}, decidedAt = new Date().toISOString()) {
  const id = `ccr_${record.id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  return {
    id,
    recordId: record.id,
    ticketId: String(record.ticketId || '').trim(),
    product: String(record.product || record.productSpec || '').trim(),
    originalL1: String(record.complaintCauseL1Final || '').trim(),
    originalL2: String(record.complaintCauseL2Final || '').trim(),
    originalL3: String(record.complaintCauseL3Final || '').trim(),
    reviewL1: String(record.complaintCauseL1Review || '').trim(),
    reviewL2: String(record.complaintCauseL2Review || '').trim(),
    reviewL3: String(record.complaintCauseL3Review || '').trim(),
    reason: String(record.complaintCauseReviewReason || '').trim(),
    decision,
    decidedAt,
    decidedByUserId: String(actor.userId || '').trim(),
    decidedByUsername: String(actor.username || '').trim(),
  }
}

/**
 * 应用同意/拒绝：归档快照用原 Final；同意时把 Review 写入 Final；始终清空拟复核。
 *
 * @param {FeedbackRecord} record
 * @param {ComplaintCauseReviewDecision} decision
 * @returns {FeedbackRecord}
 */
export function applyComplaintCauseReviewDecisionToRecord(record, decision) {
  const cleared = clearComplaintCauseReviewFields()
  const manualTagFields = getManualTagFields(record).filter((d) => d !== 'complaintCauseReview')
  /** @type {FeedbackRecord} */
  const next = {
    ...record,
    ...cleared,
    manualTagFields,
  }
  if (decision === 'agree') {
    next.complaintCauseL1Final = String(record.complaintCauseL1Review || '').trim()
    next.complaintCauseL2Final = String(record.complaintCauseL2Review || '').trim()
    next.complaintCauseL3Final = String(record.complaintCauseL3Review || '').trim()
  }
  return next
}

/**
 * Admin 弹窗行（未归档）。
 * @param {FeedbackRecord} record
 * @param {ComplaintCauseReviewDecision | ''} [decision]
 */
export function toComplaintCauseReviewAdminRow(record, decision = '') {
  return {
    key: record.id,
    recordId: record.id,
    ticketId: String(record.ticketId || '').trim(),
    product: String(record.product || record.productSpec || '').trim(),
    originalL1: String(record.complaintCauseL1Final || '').trim(),
    originalL2: String(record.complaintCauseL2Final || '').trim(),
    originalL3: String(record.complaintCauseL3Final || '').trim(),
    reviewL1: String(record.complaintCauseL1Review || '').trim(),
    reviewL2: String(record.complaintCauseL2Review || '').trim(),
    reviewL3: String(record.complaintCauseL3Review || '').trim(),
    reason: String(record.complaintCauseReviewReason || '').trim(),
    decision,
  }
}

export const COMPLAINT_CAUSE_REVIEW_DECISION_OPTIONS = [
  { label: '同意', value: 'agree' },
  { label: '拒绝', value: 'reject' },
]

export const COMPLAINT_CAUSE_REVIEW_ADMIN_EXPORT_HEADERS = [
  '工单号',
  '产品名称',
  '原投诉原因一级（终判）',
  '原投诉原因二级（终判）',
  '原投诉原因三级（终判）',
  '复核投诉原因一级（终判）',
  '复核投诉原因二级（终判）',
  '复核投诉原因三级（终判）',
  '申请原因',
  '复核结果',
]

/**
 * @param {{ ticketId: string; decision?: string; [k: string]: unknown }} row
 * @param {Map<string, object>} byTicketId
 */
export function mergeComplaintCauseReviewImportRow(row, byTicketId) {
  const ticketId = String(row.ticketId || row['工单号'] || '').trim()
  if (!ticketId || !byTicketId.has(ticketId)) return null
  const existing = byTicketId.get(ticketId)
  const rawDecision = String(row.decision || row['复核结果'] || '').trim()
  let decision = existing.decision || ''
  if (rawDecision === '同意' || rawDecision === 'agree') decision = 'agree'
  else if (rawDecision === '拒绝' || rawDecision === 'reject') decision = 'reject'
  else if (rawDecision === '') decision = ''
  return { ...existing, decision }
}
