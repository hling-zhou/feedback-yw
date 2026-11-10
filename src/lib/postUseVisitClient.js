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
 * 2026-11-05 评估状态自动流转：evaluationSubmitted 提交=true（已评估）/ 暂存=false（评估中）。
 * @param {string} id
 * @param {{
 *   internalEvaluationDetail?: string
 *   internalConclusion?: string
 *   remark?: string
 *   assigneeName?: string
 *   actionId?: string
 *   evaluationSubmitted?: boolean
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

/**
 * 2026-11-10 临时功能（admin 专属，处理完存量重复数据后下线）：删除一条回访记录。
 * 服务端联动摘除 records 表挂接的 customerVisit 快照。
 * @param {string} id
 * @returns {Promise<{ ok: boolean, id: string, detached: number }>}
 */
export function deletePostUseVisit(id) {
  return apiFetch(`/api/post-use-visits/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}
