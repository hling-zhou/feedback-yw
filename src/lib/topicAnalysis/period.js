import { DEFAULT_TENANT_ID, SCHEMA_VERSION } from '../../domain/constants.js'
import {
  buildPeriodSpec,
  insightPeriodFromSpec,
  shiftYearMonth,
} from '../../domain/insightPeriod.js'
import { filterRecordsForScope } from '../../snapshots/recordScope.js'
import { listAllFeedbacks } from '../../storage/feedbackStore.js'

export const TOPIC_ROLLING_MONTHS = 9
export const TOPIC_RECENT_MONTHS = 4
export const TOPIC_BASELINE_MONTHS = 5

/**
 * 近 rolling 个月拆成近期 / 基线月列表（含 toMonth）。
 * @param {string} toMonth YYYY-MM
 * @param {{ recentMonths?: number, baselineMonths?: number }} [options]
 */
export function splitTopicRecommendWindow(toMonth, options = {}) {
  const recentCount = options.recentMonths ?? TOPIC_RECENT_MONTHS
  const baselineCount = options.baselineMonths ?? TOPIC_BASELINE_MONTHS
  const recent = []
  for (let i = recentCount - 1; i >= 0; i -= 1) {
    recent.push(shiftYearMonth(toMonth, -i) || toMonth)
  }
  const baseline = []
  for (let i = baselineCount - 1; i >= 0; i -= 1) {
    baseline.push(shiftYearMonth(toMonth, -(recentCount + i)) || toMonth)
  }
  return { recent, baseline, all: [...baseline, ...recent] }
}

/**
 * @param {Date} [now]
 */
export function currentYearMonth(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/**
 * 当前月往前共 monthCount 个自然月（含本月），仅内存对象，不写入洞察周期列表。
 * @param {number} [monthCount]
 * @param {Date} [now]
 */
export function buildRollingMonthPeriod(monthCount = TOPIC_ROLLING_MONTHS, now = new Date()) {
  const toMonth = currentYearMonth(now)
  const fromMonth = shiftYearMonth(toMonth, -(monthCount - 1)) || toMonth
  const spec = buildPeriodSpec({ granularity: 'custom', fromMonth, toMonth })
  return insightPeriodFromSpec(spec, SCHEMA_VERSION, DEFAULT_TENANT_ID)
}

/**
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 */
export function snapshotPeriod(period) {
  const fromMonth = period?.customFromMonth || period?.startDate?.slice(0, 7) || ''
  const toMonth = period?.customToMonth || period?.endDate?.slice(0, 7) || ''
  return {
    id: period?.id || '',
    label: period?.label || '',
    fromMonth,
    toMonth,
    startDate: period?.startDate || '',
    endDate: period?.endDate || '',
    granularity: period?.granularity || 'custom',
  }
}

/**
 * @param {{ fromMonth?: string, toMonth?: string, label?: string } | null | undefined} snapshot
 */
export function periodFromSnapshot(snapshot) {
  if (snapshot?.fromMonth && snapshot?.toMonth) {
    const spec = buildPeriodSpec({
      granularity: 'custom',
      fromMonth: snapshot.fromMonth,
      toMonth: snapshot.toMonth,
    })
    return insightPeriodFromSpec(spec, SCHEMA_VERSION, DEFAULT_TENANT_ID)
  }
  return buildRollingMonthPeriod()
}

/**
 * @param {{ listRecords?: Function, init?: Function }} adapter
 * @param {import('../../domain/insightPeriod.js').InsightPeriod | null | undefined} period
 */
export async function loadRecordsForTopicPeriod(adapter, period) {
  if (!adapter) return []
  const all = await listAllFeedbacks(adapter)
  return filterRecordsForScope(all, period)
}
