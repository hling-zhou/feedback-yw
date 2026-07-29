import {
  listMonthsInclusive,
  normalizeInsightPeriod,
  normalizeYearMonth,
} from '../domain/insightPeriod.js'
import { monthsInYear } from './wanTouRatio.js'

/**
 * 工单 Tab 趋势图月窗：
 * - 月 / 季 / 年 → 所在年全部 1–12 月
 * - 自定义 → 起止月之间（含）的月份
 *
 * @param {import('../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 * @returns {{ startMonth: string; endMonth: string; months: string[]; baselineYear: number }}
 */
export function resolveTrendMonthWindow(period) {
  const fallbackYear = new Date().getFullYear()
  const fallbackStart = `${fallbackYear}-01`
  const fallbackEnd = `${fallbackYear}-12`

  if (!period) {
    return {
      startMonth: fallbackStart,
      endMonth: fallbackEnd,
      months: monthsInYear(fallbackYear),
      baselineYear: fallbackYear,
    }
  }

  const p = normalizeInsightPeriod(period)

  if (p.granularity === 'custom') {
    const startMonth =
      normalizeYearMonth(p.customFromMonth) || normalizeYearMonth(p.startDate?.slice(0, 7))
    const endMonth =
      normalizeYearMonth(p.customToMonth) || normalizeYearMonth(p.endDate?.slice(0, 7))
    if (startMonth && endMonth) {
      const months = listMonthsInclusive(startMonth, endMonth)
      return {
        startMonth,
        endMonth,
        months,
        baselineYear: Number(endMonth.slice(0, 4)),
      }
    }
  }

  const year =
    p.anchorYear ||
    Number((p.endDate || p.startDate || '').slice(0, 4)) ||
    fallbackYear
  const startMonth = `${year}-01`
  const endMonth = `${year}-12`
  return {
    startMonth,
    endMonth,
    months: monthsInYear(year),
    baselineYear: year,
  }
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 * @param {string[]} months YYYY-MM
 */
export function filterRecordsByImportMonths(records, months) {
  if (!months?.length) return []
  const set = new Set(months)
  return (records || []).filter((r) => {
    const m = r?.importMonth
    if (m && /^\d{4}-\d{2}/.test(String(m))) {
      return set.has(String(m).slice(0, 7))
    }
    const created = r?.createdAt?.slice(0, 7)
    return created ? set.has(created) : false
  })
}
