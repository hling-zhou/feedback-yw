import { useMemo } from 'react'
import { useInsights } from '../context/InsightsContext.jsx'
import { recordMatchesPeriod } from '../domain/insightPeriod.js'
import { filterRecordsForScope } from '../snapshots/recordScope.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * 洞察周期内数据口径（SSOT）：按 importMonth / createdAt 匹配周期，与 insightPeriodId 无关。
 *
 * @param {Object} [options]
 * @param {FeedbackRecord[]} [options.feedbacks] 默认 InsightsContext.feedbacks
 * @param {InsightPeriod | null} [options.period] 默认 InsightsContext.currentPeriod
 */
export function usePeriodScope(options = {}) {
  const { feedbacks: ctxFeedbacks, currentPeriod, totalRecordCount } = useInsights()
  const feedbacks = options.feedbacks ?? ctxFeedbacks
  const period = options.period !== undefined ? options.period : currentPeriod

  const periodFeedbacks = useMemo(
    () => filterRecordsForScope(feedbacks, period),
    [feedbacks, period],
  )

  const periodCount = periodFeedbacks.length
  const totalInDb =
    options.feedbacks != null
      ? feedbacks.length
      : totalRecordCount > 0
        ? totalRecordCount
        : feedbacks.length

  const matchesPeriod = useMemo(
    () => (/** @type {FeedbackRecord} */ fb) => recordMatchesPeriod(fb, period),
    [period],
  )

  return {
    feedbacks,
    period,
    periodFeedbacks,
    periodCount,
    totalInDb,
    matchesPeriod,
  }
}

/**
 * 按来源统计周期内 / 库内条数（工作台空状态等）
 *
 * @param {FeedbackRecord[]} feedbacks
 * @param {InsightPeriod | null | undefined} period
 * @param {DataSourceType} dataSourceType
 */
export function countBySourceInScope(feedbacks, period, dataSourceType) {
  const inPeriod = filterRecordsForScope(feedbacks, period, dataSourceType).length
  const totalInDb = feedbacks.filter((fb) => {
    const type = fb.dataSourceType || 'complaint_ticket'
    return type === dataSourceType
  }).length
  return { inPeriod, totalInDb }
}
