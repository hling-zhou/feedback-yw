/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

import { getManualTagFields } from '../lib/manualTagFields.js'

/** @type {number} */
export const COMPLAINT_CAUSE_REVIEW_MAX_LENGTH = 200

/** @type {number} */
export const COMPLAINT_CAUSE_REVIEW_REASON_MAX_LENGTH = 500

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {boolean}
 */
export function hasPendingComplaintCauseReview(record) {
  return Boolean(
    record?.complaintCauseL1Review?.trim()
      || record?.complaintCauseL2Review?.trim()
      || record?.complaintCauseL3Review?.trim()
      || record?.complaintCauseReviewReason?.trim(),
  )
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {boolean}
 */
export function hasManualComplaintCauseReview(record) {
  return hasPendingComplaintCauseReview(record)
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {boolean}
 */
export function isComplaintCauseReviewManuallyMaintained(record) {
  return (
    hasManualComplaintCauseReview(record)
    || getManualTagFields(record).includes('complaintCauseReview')
  )
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {{ l1: string; l2: string; l3: string; reason: string }}
 */
export function getComplaintCauseReviewDraftDisplay(record) {
  return {
    l1: record?.complaintCauseL1Review?.trim() ?? '',
    l2: record?.complaintCauseL2Review?.trim() ?? '',
    l3: record?.complaintCauseL3Review?.trim() ?? '',
    reason: record?.complaintCauseReviewReason?.trim() ?? '',
  }
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {boolean} touched
 * @returns {boolean}
 */
export function shouldIncludeComplaintCauseReviewInSave(record, touched) {
  return isComplaintCauseReviewManuallyMaintained(record) || touched
}

/**
 * @param {{ l1?: string; l2?: string; l3?: string; reason?: string }} values
 * @returns {{
 *   complaintCauseL1Review: string
 *   complaintCauseL2Review: string
 *   complaintCauseL3Review: string
 *   complaintCauseReviewReason: string
 * }}
 */
export function normalizeComplaintCauseReviewInput(values) {
  const norm = (v, max = COMPLAINT_CAUSE_REVIEW_MAX_LENGTH) =>
    String(v ?? '').trim().slice(0, max)
  return {
    complaintCauseL1Review: norm(values.l1),
    complaintCauseL2Review: norm(values.l2),
    complaintCauseL3Review: norm(values.l3),
    complaintCauseReviewReason: norm(values.reason, COMPLAINT_CAUSE_REVIEW_REASON_MAX_LENGTH),
  }
}

/**
 * Admin 归档后清空拟复核字段。
 * @returns {{
 *   complaintCauseL1Review: string
 *   complaintCauseL2Review: string
 *   complaintCauseL3Review: string
 *   complaintCauseReviewReason: string
 * }}
 */
export function clearComplaintCauseReviewFields() {
  return {
    complaintCauseL1Review: '',
    complaintCauseL2Review: '',
    complaintCauseL3Review: '',
    complaintCauseReviewReason: '',
  }
}
