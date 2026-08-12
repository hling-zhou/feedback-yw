import { preserveManualTags } from './manualTagFields.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * 同工单号再导入时始终保留的用户侧字段（不依赖 manualTagFields）。
 * 含备注、会议待办、确立举措、人工复核文本等。
 *
 * @param {FeedbackRecord} existing
 * @param {FeedbackRecord} processed
 * @returns {FeedbackRecord}
 */
export function preserveUserEditedTicketFields(existing, processed) {
  return {
    ...processed,
    note: existing.note,
    status: existing.status ?? processed.status,
    ticketTodo: existing.ticketTodo,
    listeningReviewed: Boolean(existing.listeningReviewed) || Boolean(processed.listeningReviewed),
    establishedAction: existing.establishedAction,
    establishedActionDetail: existing.establishedActionDetail,
    actionId: existing.actionId,
    actionSchedule: existing.actionSchedule,
    productGroupOptimization: existing.productGroupOptimization,
    designerOptimization: existing.designerOptimization,
    manualReviewOptimization: existing.manualReviewOptimization,
    manualReviewRootCause: existing.manualReviewRootCause,
    manualReviewSolution: existing.manualReviewSolution,
    manualReviewAction: existing.manualReviewAction,
    complaintCauseL1Review: existing.complaintCauseL1Review,
    complaintCauseL2Review: existing.complaintCauseL2Review,
    complaintCauseL3Review: existing.complaintCauseL3Review,
    complaintCauseReviewReason: existing.complaintCauseReviewReason,
    rootCauseReview: String(existing.rootCauseReview || '').trim()
      ? existing.rootCauseReview
      : processed.rootCauseReview,
    // 回访满意度通常来自独立导入，Excel 再导入不覆盖
    followUpSatisfaction: existing.followUpSatisfaction ?? processed.followUpSatisfaction,
  }
}

/**
 * 同工单号再导入合并：
 * - 覆盖：导入表字段与本次打标结果（以 incoming 为准）
 * - 保留：记录 id、人工维护维度（manualTagFields）及用户侧字段
 *
 * @param {FeedbackRecord} existing
 * @param {FeedbackRecord} incoming
 * @returns {FeedbackRecord}
 */
export function mergeTicketImportOverExisting(existing, incoming) {
  const withIdentity = {
    ...incoming,
    id: existing.id,
    tenantId: existing.tenantId || incoming.tenantId,
  }
  const withUserFields = preserveUserEditedTicketFields(existing, withIdentity)
  return preserveManualTags(existing, withUserFields, { forceOverride: false })
}
