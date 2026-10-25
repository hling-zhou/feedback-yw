import { buildPeriodSpec, formatPeriodRange, periodIdFromSpec } from '../domain/insightPeriod.js'
import { LEGACY_INSIGHT_PERIOD_ID } from '../domain/constants.js'

const YM_PATTERN = /^\d{4}-\d{2}$/

/**
 * 月份聚合（importMonth + count）中 count > 0 的数据月份集合。
 * months 非数组（如本机 IDB 模式未加载月度汇总）时返回 null，表示数据可用性未知。
 * @param {Array<{ importMonth?: string; count?: number }> | null | undefined} months
 * @returns {Set<string> | null}
 */
function toDataMonthSet(months) {
  if (!Array.isArray(months)) return null
  const set = new Set()
  for (const month of months) {
    if (!month) continue
    const ym = String(month.importMonth || '').slice(0, 7)
    if (!YM_PATTERN.test(ym) || !(Number(month.count) > 0)) continue
    set.add(ym)
  }
  return set
}

/**
 * 周期覆盖的月份区间 [起始月, 结束月]；起止推断不出合法月份时返回 null。
 * @param {Record<string, unknown>} period
 * @returns {{ from: string; to: string } | null}
 */
function periodMonthRange(period) {
  const from = String(period.startDate || '').slice(0, 7)
  const to = String(period.endDate || period.startDate || '').slice(0, 7)
  if (!YM_PATTERN.test(from) || !YM_PATTERN.test(to)) return null
  return { from, to }
}

/**
 * 周期覆盖范围内是否任一数据月份有记录；数据可用性未知时一律视为可选。
 * @param {Record<string, unknown>} period
 * @param {Set<string> | null} dataMonths
 */
function periodHasData(period, dataMonths) {
  if (!dataMonths) return true
  const range = periodMonthRange(period)
  if (!range) return false
  for (const ym of dataMonths) {
    if (ym >= range.from && ym <= range.to) return true
  }
  return false
}

/**
 * 构建提醒邮件周期下拉选项：
 * - 排除 legacy 兜底周期与无起始时间的周期
 * - 月度汇总可用时按数据判定，不按自然时间截断：
 *   - 周期覆盖范围内任一月份有记录才可选——预导入的未来数据月同样可选，
 *     无数据的周期（含未来空周期）不再出现；
 *   - 每个数据月份保底可选：缺周期对象时按稳定 id（period:month:YYYY-MM）
 *     补造月粒度选项，服务端 getInsightPeriod 可由稳定 id 反推，预览/发送
 *     不要求周期对象落库；
 * - 月度汇总不可用（本机 IDB 模式）时不按数据过滤、不补造，仅排除 legacy；
 * - label 优先周期自带 label，缺省回退起止区间，再回退起始日期；
 *   已归档周期追加「（已归档）」后缀；
 * - 按起始时间倒序；同起始时间时结束更晚的在前（如 Q3 排在 2026年7月 之前）；
 * - 同 id 重复周期只保留排序后的第一条。
 *
 * @param {Array<Record<string, unknown>> | null | undefined} periods
 * @param {Array<{ importMonth?: string; count?: number }> | null} [months]
 *   月度聚合（/records/month-summary 的 months），null 表示数据可用性未知
 * @returns {{ value: string; label: string }[]}
 */
export function buildReminderPeriodOptions(periods, months = null) {
  if (!Array.isArray(periods)) return []
  const dataMonths = toDataMonthSet(months)

  const entries = []
  for (const p of periods) {
    if (!p || !p.id) continue
    if (p.id === LEGACY_INSIGHT_PERIOD_ID) continue
    if (!p.startDate) continue
    if (!periodHasData(p, dataMonths)) continue
    const base =
      p.label || (p.endDate ? formatPeriodRange(p) : '') || String(p.startDate || p.id)
    entries.push({
      id: p.id,
      label: `${base}${p.status === 'archived' ? '（已归档）' : ''}`,
      startDate: String(p.startDate),
      endDate: String(p.endDate || ''),
      monthStart: p.granularity === 'month' ? String(p.startDate) : '',
    })
  }

  if (dataMonths) {
    const existingIds = new Set(entries.map((e) => e.id))
    const existingMonthStarts = new Set(
      entries.filter((e) => e.monthStart).map((e) => e.monthStart),
    )
    for (const ym of dataMonths) {
      const [year, month] = ym.split('-').map(Number)
      const spec = buildPeriodSpec({ granularity: 'month', year, month })
      const id = periodIdFromSpec(spec)
      // 同月已有周期对象（含非规范 id 的月周期）时不重复补造
      if (existingIds.has(id) || existingMonthStarts.has(spec.startDate)) continue
      existingIds.add(id)
      existingMonthStarts.add(spec.startDate)
      entries.push({
        id,
        label: spec.label,
        startDate: spec.startDate,
        endDate: spec.endDate,
        monthStart: spec.startDate,
      })
    }
  }

  entries.sort(
    (a, b) =>
      b.startDate.localeCompare(a.startDate) ||
      b.endDate.localeCompare(a.endDate) ||
      b.id.localeCompare(a.id),
  )

  const byId = new Map()
  for (const entry of entries) {
    if (!byId.has(entry.id)) byId.set(entry.id, { value: entry.id, label: entry.label })
  }
  return [...byId.values()]
}
