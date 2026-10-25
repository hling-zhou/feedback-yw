import { formatPeriodRange } from '../domain/insightPeriod.js'
import { LEGACY_INSIGHT_PERIOD_ID } from '../domain/constants.js'

function toLocalIsoDate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/**
 * 构建提醒邮件周期下拉选项：
 * - 过滤 legacy 周期与尚未开始的未来周期（超出平台数据时间范围，无可提醒数据）
 * - label 优先周期自带 label，缺省回退起止区间，再回退起始日期
 * - 已归档周期追加「（已归档）」后缀
 * - 同 id 重复周期只保留一条
 * - 按起始时间倒序；同起始时间时结束更晚的在前（如 Q3 排在 2026年7月 之前）
 *
 * @param {Array<Record<string, unknown>> | null | undefined} periods
 * @param {Date} [now] 用于判定「未来周期」的当前时间，测试可注入
 * @returns {{ value: string; label: string }[]}
 */
export function buildReminderPeriodOptions(periods, now = new Date()) {
  if (!Array.isArray(periods)) return []
  const today = toLocalIsoDate(now)
  const eligible = periods.filter((p) => {
    if (!p || !p.id) return false
    if (p.id === LEGACY_INSIGHT_PERIOD_ID) return false
    if (!p.startDate) return false
    return p.startDate <= today
  })
  const sorted = [...eligible].sort(
    (x, y) =>
      (y.startDate || '').localeCompare(x.startDate || '') ||
      (y.endDate || '').localeCompare(x.endDate || ''),
  )
  const byId = new Map()
  for (const p of sorted) {
    if (byId.has(p.id)) continue
    const base =
      p.label || (p.endDate ? formatPeriodRange(p) : '') || String(p.startDate || p.id)
    const archived = p.status === 'archived' ? '（已归档）' : ''
    byId.set(p.id, { value: p.id, label: `${base}${archived}` })
  }
  return [...byId.values()]
}
