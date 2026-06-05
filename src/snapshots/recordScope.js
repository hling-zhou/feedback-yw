import { LEGACY_INSIGHT_PERIOD_ID } from '../domain/constants.js'
import { recordMatchesPeriod } from '../domain/insightPeriod.js'
import { extractFollowUpTicketRecords } from '../lib/followUpSatisfactionAnalytics.js'

/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */

/**
 * @deprecated 周期取数已改为按数据时间；仅用于展示导入批次元数据
 * @param {FeedbackRecord} fb
 */
export function recordPeriodId(fb) {
  return fb.insightPeriodId || LEGACY_INSIGHT_PERIOD_ID
}

/**
 * @param {FeedbackRecord} fb
 */
export function recordSourceType(fb) {
  return fb.dataSourceType || 'complaint_ticket'
}

/**
 * 按洞察周期的数据时间范围筛选（importMonth / createdAt），非 insightPeriodId
 * @param {FeedbackRecord[]} feedbacks
 * @param {InsightPeriod | null | undefined} period
 * @param {DataSourceType} [dataSourceType]
 */
export function filterRecordsForScope(feedbacks, period, dataSourceType) {
  return feedbacks.filter((fb) => {
    if (dataSourceType && recordSourceType(fb) !== dataSourceType) return false
    return recordMatchesPeriod(fb, period)
  })
}

/**
 * @param {FeedbackRecord[]} feedbacks
 * @param {InsightPeriod | null | undefined} period
 */
export function countRecordsInPeriod(feedbacks, period) {
  return filterRecordsForScope(feedbacks, period).length
}

/**
 * @param {FeedbackRecord[]} feedbacks
 * @param {string[]} recordIds
 */
export function resolveRecordsByIds(feedbacks, recordIds) {
  const set = new Set(recordIds)
  return feedbacks.filter((fb) => set.has(fb.id))
}

/**
 * 从快照 recordIds 解析工单；若记录已改 dataSourceType（如咨询改投/误导入后修正），
 * 丢弃与快照来源不一致的项，避免投诉 Tab 仍展示已改为咨询的工单。
 * @param {FeedbackRecord[]} feedbacks
 * @param {import('../domain/snapshot.js').InsightSnapshot | null | undefined} snapshot
 */
export function resolveSnapshotRecords(feedbacks, snapshot) {
  const ids = snapshot?.recordIds
  if (!ids?.length) return []
  const expected = snapshot?.dataSourceType
  return resolveRecordsByIds(feedbacks, ids).filter(
    (fb) => !expected || recordSourceType(fb) === expected,
  )
}

/**
 * 用后即评 Tab：除独立评价记录外，周期内工单的回访补全也算有内容。
 * @param {FeedbackRecord[]} feedbacks
 * @param {InsightPeriod | null | undefined} period
 * @param {import('../domain/snapshot.js').InsightSnapshot | null | undefined} snapshot
 */
export function postUseRatingFollowUpHasContent(feedbacks, period, snapshot) {
  if ((snapshot?.aggregates?.followUpSatisfactionMetrics?.scoredCount ?? 0) > 0) {
    return true
  }
  const tickets = [
    ...filterRecordsForScope(feedbacks, period, 'complaint_ticket'),
    ...filterRecordsForScope(feedbacks, period, 'consultation_ticket'),
  ]
  return extractFollowUpTicketRecords(tickets).length > 0
}

/**
 * 工作台来源 Tab 是否应展示图表（避免快照 rebuilding 中间态导致 Tab 空/满闪烁）
 * @param {FeedbackRecord[]} feedbacks
 * @param {import('../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 * @param {import('../domain/snapshot.js').InsightSnapshot | null | undefined} snapshot
 */
export function workbenchSourceHasContent(feedbacks, period, snapshot) {
  if (!snapshot?.dataSourceType) return false
  const resolved = resolveSnapshotRecords(feedbacks, snapshot)
  if (resolved.length > 0) return true
  if (
    snapshot.status === 'stale' ||
    snapshot.status === 'rebuilding' ||
    !(snapshot.recordIds?.length)
  ) {
    if (filterRecordsForScope(feedbacks, period, snapshot.dataSourceType).length > 0) {
      return true
    }
  } else if ((snapshot.summary?.recordCount ?? 0) > 0) {
    return true
  }

  if (snapshot.dataSourceType === 'post_use_rating') {
    return postUseRatingFollowUpHasContent(feedbacks, period, snapshot)
  }
  return false
}

/**
 * 工单工作台展示用记录：快照 ID 优先；快照过期/重建中则按周期+来源回退到实时库内数据
 * @param {FeedbackRecord[]} feedbacks
 * @param {import('../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 * @param {import('../domain/snapshot.js').InsightSnapshot} snapshot
 */
export function workbenchTicketRecords(feedbacks, period, snapshot) {
  const fromSnapshot = resolveSnapshotRecords(feedbacks, snapshot)
  if (fromSnapshot.length > 0) return fromSnapshot
  if (
    snapshot.status === 'stale' ||
    snapshot.status === 'rebuilding' ||
    !(snapshot.recordIds?.length)
  ) {
    return filterRecordsForScope(feedbacks, period, snapshot.dataSourceType)
  }
  return fromSnapshot
}
