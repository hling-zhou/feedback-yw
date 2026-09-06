/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

import { getManualTagFields } from '../lib/manualTagFields.js'
import {
  isComplaintCauseTreeText,
  sanitizeImportProblemCauseForReview,
} from '../lib/painPointClustering/clusteringCause.js'
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
 * 列表 / 导出「问题原因」统一取值：人工复核(人工) → 自动生成(自动)。
 * 不再回退导入列「问题原因」（避免脏数据被误标为人工复核）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {{ value: string, tag: '人工' | '自动' | null }}
 */
export function getProblemCauseDisplay(record) {
  const manual = record?.rootCauseReview?.trim()
  if (manual) return { value: manual, tag: '人工' }
  const auto = getAutoRootCauseDisplay(record)
  if (auto) return { value: auto, tag: '自动' }
  return { value: '', tag: null }
}

/**
 * 工单详情/导出可读的有效根因排查（人工复核）：优先已存值，否则回退未污染的导入列「问题原因」。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getEffectiveRootCauseReview(record) {
  const stored = record?.rootCauseReview?.trim()
  if (stored) return stored
  return sanitizeRootCauseReviewFallback(record)
}

/**
 * 导入列「问题原因」原文（可能是终判树污染）。
 * @param {FeedbackRecord | null | undefined} record
 */
export function getRootCauseReviewImportColumn(record) {
  return resolveRootCauseReviewFallback(record ?? {})
}

/**
 * 导入列是否被填成投诉原因终判树，不能当人工复核预填。
 * @param {FeedbackRecord | null | undefined} record
 */
export function isRootCauseReviewFallbackPolluted(record) {
  return isComplaintCauseTreeText(getRootCauseReviewImportColumn(record))
}

/**
 * 未保存复核时的可用回退：真实机制句可预填；终判树不预填（聚类也不会当复核用）。
 * @param {FeedbackRecord | null | undefined} record
 */
export function sanitizeRootCauseReviewFallback(record) {
  return sanitizeImportProblemCauseForReview(getRootCauseReviewImportColumn(record))
}

/**
 * 详情页人工复核输入框说明。
 * @param {FeedbackRecord | null | undefined} record
 */
export function getRootCauseReviewEditorHint(record) {
  if (isRootCauseReviewManuallyMaintained(record)) {
    return '已人工复核；重新打标默认保留此维度。'
  }
  if (isRootCauseReviewFallbackPolluted(record)) {
    return '导入列「问题原因」是投诉原因终判路径，未写入人工复核，聚类也不会把它当问题原因。请填写可核对的配置/组件/流程状态；留空则使用上方「根因（自动）」。'
  }
  return '可填写人工复核的问题原因并保存（将标记为人工资护维度）；导入列「问题原因」仅作只读建议，不会自动写入。'
}

/**
 * 详情页人工复核输入框占位。
 * @param {FeedbackRecord | null | undefined} record
 */
export function getRootCauseReviewEditorPlaceholder(record) {
  if (
    isRootCauseReviewFallbackPolluted(record)
    && !isRootCauseReviewManuallyMaintained(record)
  ) {
    return '请填写可核对的问题原因，或留空使用自动生成'
  }
  return '请输入人工复核的问题原因，或留空使用上方自动生成'
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
 * 人工复核打开时 TextArea 展示值：未人工维护时仅预填未污染的导入列「问题原因」。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @returns {string}
 */
export function getRootCauseReviewDraftDisplay(record) {
  if (isRootCauseReviewManuallyMaintained(record)) {
    return record?.rootCauseReview?.trim() ?? ''
  }
  // 未人工维护时不再预填导入列「问题原因」，避免脏数据被误存为人工复核
  return ''
}

/**
 * 详情页「人工复核」只读建议：导入列「问题原因」经污染过滤后的原文。
 * 仅作建议展示，不写入 rootCauseReview（除非用户主动复制并保存）。
 *
 * @param {FeedbackRecord | null | undefined} record
 */
export function getRootCauseReviewImportSuggestion(record) {
  return sanitizeRootCauseReviewFallback(record)
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
