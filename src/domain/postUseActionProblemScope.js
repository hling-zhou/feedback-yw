/**
 * 用后即评举措 ↔ 关联溯源/回访的问题面聚合（2026-11-27 需求，DESIGN-用后即评举措聚合问题面）。
 *
 * 与工单侧 buildActionProblemScope 同构（锚点/前后对比原样复用），差异在数据链与签名：
 * - 数据链：post_use 举措的关联记录是溯源（post_use_jira_items）与回访
 *   （post_use_visit_records_v1），由宿主抽屉经 /api/post-use-actions/linked/:actionId
 *   fetch 后传入（同源判定纪律——与分区4 关联反馈共用同一份 postUseSources，不重复请求）。
 * - 签名 = productName | sourceKind（trace / visit 两类，11-27 拍板）；溯源细分
 *   （问卷类/投诉回访）进辅助 Tag 不进签名。月份不进签名——进趋势轴（进签名则面碎成
 *   单月碎片、前后对比永远数据不足；月份区间由 face 的 firstMonth/lastMonth 承载）。
 * - 压降口径 = linked-only（11-27 拍板）：趋势 = 该举措自己关联的记录月度分布，
 *   与工单抽屉侧同构；非"同产品全量"。
 * - 回访评估状态 Tag 展示（11-27 拍板）：visitEvaluationState 共享谓词 plurality。
 *
 * 月份解析特化：溯源 importMonth 可能是"、"分隔多月份文本（清单 tab 跨月行）——
 * 按月拆分，一条多月份记录在其覆盖的每个月各计 1 条；回访取 importMonth || visitMonth。
 * 无月份记录仍计入 recordCount，不进趋势。
 */

import { resolveActionAnchor, computeReduction } from './actionProblemScope.js'
import { visitEvaluationState } from '../lib/postUseRating/visitRecords.js'

/** @typedef {import('./actionItem.js').ActionItem} ActionItem */

/** @param {unknown} raw */ function trim(raw) { return String(raw ?? '').trim() }

/**
 * 溯源细分来源的展示标签（sourceType → 中文）。
 * @param {Record<string, unknown> | null | undefined} trace
 */
function traceSubTypeLabel(trace) {
  const sourceType = trim(trace?.sourceType)
  if (sourceType === 'callback_non_ten') return '投诉回访'
  if (sourceType === 'questionnaire') return '问卷类'
  return ''
}

/**
 * @param {Record<string, unknown> | null | undefined} visit
 */
function visitMonth(visit) {
  return trim(visit?.importMonth) || trim(visit?.visitMonth)
}

/**
 * 拆分溯源记录的多月份文本（"、"分隔；单月/空原样）。
 * @param {Record<string, unknown> | null | undefined} trace
 * @returns {string[]}
 */
function splitTraceMonths(trace) {
  const raw = trim(trace?.importMonth)
  if (!raw) return []
  return raw.split('、').map((m) => m.trim()).filter(Boolean)
}

/** @param {string[]} values @returns {string}（与工单侧 pluralityLabel 同判据：众数优先） */
function pluralityLabel(values) {
  const counts = new Map()
  for (const value of values) {
    const key = trim(value)
    if (!key) continue
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  if (!counts.size) return ''
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))[0][0]
}

/** @param {string[]} months @returns {{ date: string; count: number }[]}（有序月度计数行） */
function buildMonthlyTrend(months) {
  const counts = new Map()
  for (const month of months) {
    if (!/^\d{4}-\d{2}$/.test(month)) continue
    counts.set(month, (counts.get(month) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, count]) => ({ date, count }))
}

/** @param {string[]} feedbacks 组内反馈文本 @returns {string} 最长文本（信息量最大判据，与回访预导入/迁移脚本同源） */
function pickLongestFeedback(feedbacks) {
  let best = ''
  for (const text of feedbacks) {
    if (text.length > best.length) best = text
  }
  return best
}

/**
 * 以用后即评举措为中心：聚合其关联溯源/回访为问题面（产品×来源两类）。
 * @param {ActionItem | null | undefined} action
 * @param {{ traces?: Array<Record<string, unknown>>; visits?: Array<Record<string, unknown>> }} sources
 * @returns {{ problems: Array<Record<string, unknown>>; anchorDate: string; anchorMonth: string }}
 */
export function buildPostUseActionProblemScope(action, sources) {
  const { anchorDate, anchorMonth } = resolveActionAnchor(action)
  const traces = Array.isArray(sources?.traces) ? sources.traces : []
  const visits = Array.isArray(sources?.visits) ? sources.visits : []

  /** @type {Map<string, { kind: 'trace' | 'visit'; productName: string; records: Array<Record<string, unknown>>; months: string[] }>} */
  const groups = new Map()

  for (const trace of traces) {
    const productName = trim(trace?.productName)
    const key = `${productName} | trace`
    let group = groups.get(key)
    if (!group) {
      group = { kind: 'trace', productName, records: [], months: [] }
      groups.set(key, group)
    }
    group.records.push(trace)
    group.months.push(...splitTraceMonths(trace))
  }
  for (const visit of visits) {
    const productName = trim(visit?.productName)
    const key = `${productName} | visit`
    let group = groups.get(key)
    if (!group) {
      group = { kind: 'visit', productName, records: [], months: [] }
      groups.set(key, group)
    }
    group.records.push(visit)
    const month = visitMonth(visit)
    if (month) group.months.push(month)
  }

  const problems = []
  for (const [key, group] of groups) {
    const records = group.records
    const trend = buildMonthlyTrend(group.months)
    const dates = trend.map((row) => row.date)
    const feedbackTexts = records.map((record) =>
      group.kind === 'trace'
        ? trim(record?.customerFeedback)
        : (trim(record?.userFeedbackText) || trim(record?.feedbackSummary)),
    )
    problems.push({
      key,
      sourceKind: group.kind,
      sourceKindLabel: group.kind === 'trace' ? '产品部溯源' : '省代表回访',
      productName: group.productName,
      recordCount: records.length,
      subTypeLabel: group.kind === 'trace'
        ? pluralityLabel(records.map(traceSubTypeLabel))
        : '',
      statusLabel: group.kind === 'trace'
        ? pluralityLabel(records.map((record) => trim(record?.status)))
        : pluralityLabel(records.map((record) => visitEvaluationState(record))),
      feedbackSample: pickLongestFeedback(feedbackTexts),
      firstMonth: dates[0] || '',
      lastMonth: dates[dates.length - 1] || '',
      monthlyTrend: trend,
      reduction: computeReduction(trend, anchorMonth),
    })
  }
  // 记录数多者优先，同数按签名稳定序（与工单侧排序判据同构）
  problems.sort((a, b) => b.recordCount - a.recordCount || a.key.localeCompare(b.key, 'zh-CN'))
  return { problems, anchorDate, anchorMonth }
}
