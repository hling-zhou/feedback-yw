import { apiFetch } from './apiClient.js'

/** @typedef {import('./postUseRating/visitRecords.js').PostUseVisitRecord} PostUseVisitRecord */

/**
 * 客服部回访处理状态 recordId 前缀。与工单 id 空间隔离，
 * 存入 user_ticket_review (user_id, record_id)。
 */
export const POST_USE_VISIT_REVIEW_PREFIX = 'visit:'

/** @param {string} visitId */
export function postUseVisitReviewId(visitId) {
  return `${POST_USE_VISIT_REVIEW_PREFIX}${visitId}`
}

/**
 * @param {string[]} [importMonths] 支持多月份（跟随周期）
 * @returns {Promise<{ items: PostUseVisitRecord[] }>}
 */
export function listPostUseVisits(importMonths) {
  const params = new URLSearchParams()
  if (importMonths?.length) params.set('importMonth', importMonths.join('、'))
  const qs = params.toString()
  return apiFetch(`/api/post-use-visits${qs ? `?${qs}` : ''}`)
}

/**
 * 编辑客服部回访的内部评估/备注/经办人/关联举措。
 * @param {string} id
 * @param {{
 *   internalEvaluationDetail?: string
 *   internalConclusion?: string
 *   remark?: string
 *   assigneeName?: string
 *   actionId?: string
 *   baseUpdatedAt?: string
 * }} patch
 * @returns {Promise<{ item: PostUseVisitRecord }>}
 */
export function patchPostUseVisit(id, patch) {
  return apiFetch(`/api/post-use-visits/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}
