/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

import { getManualTagFields } from '../lib/manualTagFields.js'
import { resolveRootCauseReviewFallback } from './overridePolicy.js'

/** @type {number} */
export const ROOT_CAUSE_REVIEW_MAX_LENGTH = 1000

/**
 * 根因排查 · 自动生成：打标流水线写入的 rootCause（重新打标可更新）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getAutoRootCauseDisplay(record) {
  return record?.rootCause?.trim() || ''
}

/**
 * 工单详情/导出可读的有效根因排查（人工复核）：优先已存值，否则回退导入列「问题原因」。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getEffectiveRootCauseReview(record) {
  const stored = record?.rootCauseReview?.trim()
  if (stored) return stored
  return resolveRootCauseReviewFallback(record ?? {})
}

/**
 * 用户是否在详情中保存过根因排查（与 manualTagFields 维度一致）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {boolean}
 */
export function hasManualRootCauseReview(record) {
  return Boolean(record?.rootCauseReview?.trim())
}

/**
 * 根因排查是否已标记为人工维护（含用户主动清空后保存）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {boolean}
 */
export function isRootCauseReviewManuallyMaintained(record) {
  return (
    hasManualRootCauseReview(record)
    || getManualTagFields(record).includes('rootCauseReview')
  )
}

/**
 * 人工复核打开时 TextArea 展示值：未人工维护时默认导入列「问题原因」，否则显示已存值。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getRootCauseReviewDraftDisplay(record) {
  if (isRootCauseReviewManuallyMaintained(record)) {
    return record?.rootCauseReview?.trim() ?? ''
  }
  return getEffectiveRootCauseReview(record)
}

/**
 * 保存工单时是否写入 rootCauseReview（避免未编辑时将 fallback 误存为人工值）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @param {boolean} touched
 * @returns {boolean}
 */
export function shouldIncludeRootCauseReviewInSave(record, touched) {
  return isRootCauseReviewManuallyMaintained(record) || touched
}

/**
 * @param {string} value
 * @returns {string}
 */
export function normalizeRootCauseReviewInput(value) {
  return String(value ?? '').trim().slice(0, ROOT_CAUSE_REVIEW_MAX_LENGTH)
}
