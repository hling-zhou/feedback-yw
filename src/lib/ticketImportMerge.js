import { preserveManualTags } from './manualTagFields.js'
import { buildDedupeKey, buildGlobalTicketDedupeKey } from '../domain/records.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {FeedbackRecord} record
 */
export function ticketImportDuplicateKey(record) {
  const dataSourceType = record.dataSourceType || 'complaint_ticket'
  const globalTicketKey = buildGlobalTicketDedupeKey({
    dataSourceType,
    ticketId: record.ticketId,
  })
  if (globalTicketKey) return globalTicketKey
  return buildDedupeKey({
    dataSourceType,
    importMonth:
      record.importMonth || record.createdAt?.slice(0, 7) || 'unknown',
    ticketId: record.ticketId,
    id: record.id,
  })
}

/**
 * 将导入行合并进内存列表；库内已有但未加载进内存的工单也会写入 merged。
 *
 * @param {FeedbackRecord[]} prev
 * @param {FeedbackRecord[]} incoming
 * @param {Map<string, FeedbackRecord>} [existingByTicketKey]
 */
export function mergeFeedbacksInto(prev, incoming, existingByTicketKey = new Map()) {
  /** @type {Map<string, number>} */
  const indexByKey = new Map()
  const merged = prev.map((fb, index) => {
    const key = ticketImportDuplicateKey(fb)
    if (key) indexByKey.set(key, index)
    return fb
  })

  /** @type {FeedbackRecord[]} */
  const added = []
  /** @type {FeedbackRecord[]} */
  const updated = []
  const skippedDuplicates = 0

  for (const record of incoming) {
    const withMeta = {
      ...record,
      dataSourceType: record.dataSourceType || 'complaint_ticket',
    }
    const key = ticketImportDuplicateKey(withMeta)
    const existingFromMemory =
      key && indexByKey.has(key) ? merged[indexByKey.get(key)] : null
    const existingFromStore = key ? existingByTicketKey.get(key) : null
    // 优先用库内全量记录，避免列表投影缺大文本字段
    const existing = existingFromStore || existingFromMemory

    if (existing && key) {
      const next = mergeTicketImportOverExisting(existing, withMeta)
      if (indexByKey.has(key)) {
        merged[indexByKey.get(key)] = next
      } else {
        indexByKey.set(key, merged.length)
        merged.push(next)
      }
      updated.push(next)
      continue
    }

    if (key) indexByKey.set(key, merged.length)
    added.push(withMeta)
    merged.push(withMeta)
  }

  return {
    merged,
    added,
    updated,
    skippedDuplicates,
  }
}

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
