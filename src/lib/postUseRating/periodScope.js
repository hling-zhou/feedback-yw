import { listMonthsInclusive } from '../../domain/insightPeriod.js'

/**
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 */
export function postUsePeriodMonths(period) {
  const from = String(period?.startDate || '').slice(0, 7)
  const to = String(period?.endDate || '').slice(0, 7)
  return listMonthsInclusive(from, to)
}

/** 客服回访与当前用后即评范围一致，按导入数据月份筛选。 */
export function postUseVisitMonthsForPeriod(period) {
  return postUsePeriodMonths(period)
}

/** 月、季度、年看所在自然年；自定义周期严格使用指定月份范围。 */
export function postUseTrendMonthsForPeriod(period) {
  if (period?.granularity === 'custom') return postUsePeriodMonths(period)
  const year = Number(period?.anchorYear || String(period?.startDate || '').slice(0, 4))
  if (!Number.isFinite(year)) return []
  return listMonthsInclusive(`${year}-01`, `${year}-12`)
}

/**
 * @param {import('./trendStore.js').PostUseTrendSnapshot} snapshot
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 */
export function filterPostUseTrendForPeriod(snapshot, period) {
  const months = new Set(postUseTrendMonthsForPeriod(period))
  return {
    ...snapshot,
    scores: (snapshot?.scores || []).filter((row) => months.has(row.month)),
    satisfaction: (snapshot?.satisfaction || []).filter((row) => months.has(row.month)),
    reasons: (snapshot?.reasons || []).filter((row) => months.has(row.month)),
  }
}
