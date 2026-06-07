/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

import { getManualTagFields } from '../lib/manualTagFields.js'

/** @type {number} */
export const COMPLAINT_CAUSE_REVIEW_MAX_LENGTH = 200

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {boolean}
 */
export function hasManualComplaintCauseReview(record) {
  return Boolean(
    record?.complaintCauseL2Review?.trim()
      || record?.complaintCauseL3Review?.trim(),
  )
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
 * @returns {{ l2: string; l3: string }}
 */
export function getComplaintCauseReviewDraftDisplay(record) {
  return {
    l2: record?.complaintCauseL2Review?.trim() ?? '',
    l3: record?.complaintCauseL3Review?.trim() ?? '',
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
 * @param {{ l2?: string; l3?: string }} values
 * @returns {{ complaintCauseL1Review: string; complaintCauseL2Review: string; complaintCauseL3Review: string }}
 */
export function normalizeComplaintCauseReviewInput(values) {
  const norm = (v) => String(v ?? '').trim().slice(0, COMPLAINT_CAUSE_REVIEW_MAX_LENGTH)
  return {
    complaintCauseL1Review: '',
    complaintCauseL2Review: norm(values.l2),
    complaintCauseL3Review: norm(values.l3),
  }
}
