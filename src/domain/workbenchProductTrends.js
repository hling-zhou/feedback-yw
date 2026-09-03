/**
 * 洞察工作台首页「单产品体验趋势」领域逻辑。
 *
 * 4 个指标（取值范围不同，归一到 0–100 后同图看相关性）：
 * - 投诉数量（complaint_ticket 月度工单数）
 * - 咨询数量（consultation_ticket 月度工单数）
 * - 用后即评得分（post_use_rating 评分记录 ratingScore 月度均分，0–10）
 * - 投诉回访满意度（工单 followUpSatisfaction.score 的 10 分率，0–100%）
 *
 * 统一按"产品名"分组（fb.product / productName），与产品选择器对齐。
 */

import { monthlyTrendByProduct, recordMonth } from '../lib/analytics.js'
import { isPostUseRatingLibraryRecord } from './postUseRatingImport.js'
import {
  getFollowUpScore,
  hasFollowUpSatisfaction,
  resolveFollowUpTrendMonth,
} from './followUpSatisfaction.js'
import { isTicketSource } from '../lib/importUtils.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

// 复用 analytics.js 的按产品计数，对外给一个语义化别名。
export { monthlyTrendByProduct as monthlyCountByProduct }

/** @param {FeedbackRecord | null | undefined} record @returns {string} */
function recordProductName(record) {
  return (
    String(record?.product ?? '').trim() ||
    String(record?.productName ?? '').trim() ||
    '未标注产品'
  )
}

/** @param {FeedbackRecord} fb @param {string} basis @returns {string} */
function monthOf(fb, basis = 'importMonth') {
  const m = recordMonth(fb, basis)
  return m && m !== '未知月份' ? m : ''
}

/**
 * 按月×产品名聚合 ratingScore 均分。无样本月份为 null。
 * @param {FeedbackRecord[]} records
 * @param {{ basis?: string; limit?: number; scoreField?: string }} [options]
 */
export function monthlyAvgScoreByProduct(records, options = {}) {
  const basis = options.basis || 'importMonth'
  const limit = options.limit || 12
  const scoreField = options.scoreField || 'ratingScore'
  /** @type {Map<string, Map<string, { sum: number; n: number }>>} */
  const byMonth = new Map()
  /** @type {Map<string, number>} */
  const productTotals = new Map()
  for (const fb of records || []) {
    const month = monthOf(fb, basis)
    if (!month) continue
    const value = Number(fb?.[scoreField])
    if (!Number.isFinite(value)) continue
    const product = recordProductName(fb)
    if (!byMonth.has(month)) byMonth.set(month, new Map())
    const monthMap = byMonth.get(month)
    const bucket = monthMap.get(product) || { sum: 0, n: 0 }
    bucket.sum += value
    bucket.n += 1
    monthMap.set(product, bucket)
    productTotals.set(product, (productTotals.get(product) || 0) + 1)
  }
  const products = [...productTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => ({ dataKey: name, name }))
  const data = [...byMonth.keys()]
    .sort()
    .slice(-limit)
    .map((date) => {
      const monthMap = byMonth.get(date) || new Map()
      /** @type {Record<string, unknown>} */
      const row = { date }
      for (const p of products) {
        const b = monthMap.get(p.dataKey)
        row[p.dataKey] = b && b.n ? Math.round((b.sum / b.n) * 100) / 100 : null
      }
      return row
    })
  return { data, products }
}

/**
 * 按月×产品名算回访 10 分率（打 10 分占比，百分比保留 1 位小数）。
 * 仅取 followUpSatisfaction.score 有效的工单记录。
 * @param {FeedbackRecord[]} records
 * @param {{ basis?: string; limit?: number }} [options]
 */
export function monthlyTenPointRateByProduct(records, options = {}) {
  const basis = options.basis || 'importMonth'
  const limit = options.limit || 12
  /** @type {Map<string, Map<string, { ten: number; total: number }>>} */
  const byMonth = new Map()
  /** @type {Map<string, number>} */
  const productTotals = new Map()
  for (const fb of records || []) {
    if (!hasFollowUpSatisfaction(fb)) continue
    const score = getFollowUpScore(fb)
    if (score == null) continue
    const month = resolveFollowUpTrendMonth(fb.followUpSatisfaction, monthOf(fb, basis))
    if (!month) continue
    const product = recordProductName(fb)
    if (!byMonth.has(month)) byMonth.set(month, new Map())
    const monthMap = byMonth.get(month)
    const bucket = monthMap.get(product) || { ten: 0, total: 0 }
    bucket.total += 1
    if (score === 10) bucket.ten += 1
    monthMap.set(product, bucket)
    productTotals.set(product, (productTotals.get(product) || 0) + 1)
  }
  const products = [...productTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name]) => ({ dataKey: name, name }))
  const data = [...byMonth.keys()]
    .sort()
    .slice(-limit)
    .map((date) => {
      const monthMap = byMonth.get(date) || new Map()
      /** @type {Record<string, unknown>} */
      const row = { date }
      for (const p of products) {
        const b = monthMap.get(p.dataKey)
        row[p.dataKey] = b && b.total ? Math.round((b.ten / b.total) * 1000) / 10 : null
      }
      return row
    })
  return { data, products }
}

/**
 * 对一组数值做 min-max 归一到 0–100（保留 1 位小数）。
 * - null/非有限值保留为 null
 * - min===max（含全部相同）时非空值返回常数 50
 * - 空数组或全 null 返回全 null
 * @param {(number | null | undefined)[]} values
 * @returns {(number | null)[]}
 */
export function normalizeTo100(values) {
  const arr = Array.isArray(values) ? values : []
  const finite = arr
    .map((v) => (typeof v === 'number' && Number.isFinite(v) ? v : null))
    .filter((v) => v != null)
  if (!finite.length) return arr.map(() => null)
  const min = Math.min(...finite)
  const max = Math.max(...finite)
  return arr.map((v) => {
    if (typeof v !== 'number' || !Number.isFinite(v)) return null
    if (min === max) return 50
    return Math.round(((v - min) / (max - min)) * 1000) / 10
  })
}

/** @param {FeedbackRecord[]} records @param {string} basis @returns {Map<string, number>} */
function countByMonth(records, basis = 'importMonth') {
  const map = new Map()
  for (const fb of records || []) {
    const m = monthOf(fb, basis)
    if (!m) continue
    map.set(m, (map.get(m) || 0) + 1)
  }
  return map
}

/** @param {FeedbackRecord[]} records @param {string} scoreField @param {string} basis @returns {Map<string, number | null>} */
function avgByMonth(records, scoreField, basis = 'importMonth') {
  /** @type {Map<string, { sum: number; n: number }>} */
  const acc = new Map()
  for (const fb of records || []) {
    const m = monthOf(fb, basis)
    if (!m) continue
    const v = Number(fb?.[scoreField])
    if (!Number.isFinite(v)) continue
    const b = acc.get(m) || { sum: 0, n: 0 }
    b.sum += v
    b.n += 1
    acc.set(m, b)
  }
  const map = new Map()
  for (const [m, b] of acc) map.set(m, b.n ? Math.round((b.sum / b.n) * 100) / 100 : null)
  return map
}

/** @param {FeedbackRecord[]} records @param {string} basis @returns {Map<string, number | null>} */
function tenPointRateByMonth(records, basis = 'importMonth') {
  /** @type {Map<string, { ten: number; total: number }>} */
  const acc = new Map()
  for (const fb of records || []) {
    if (!hasFollowUpSatisfaction(fb)) continue
    const score = getFollowUpScore(fb)
    if (score == null) continue
    const m = resolveFollowUpTrendMonth(fb.followUpSatisfaction, monthOf(fb, basis))
    if (!m) continue
    const b = acc.get(m) || { ten: 0, total: 0 }
    b.total += 1
    if (score === 10) b.ten += 1
    acc.set(m, b)
  }
  const map = new Map()
  for (const [m, b] of acc) map.set(m, b.total ? Math.round((b.ten / b.total) * 1000) / 10 : null)
  return map
}

/** @typedef {{ key: string; name: string; unit: string }} MetricDef */

/** @type {MetricDef[]} */
const METRICS = [
  { key: 'complaint', name: '投诉数量', unit: '单' },
  { key: 'consultation', name: '咨询数量', unit: '单' },
  { key: 'postUseScore', name: '用后即评得分', unit: '分' },
  { key: 'satisfaction', name: '回访满意度', unit: '%' },
]

/**
 * 构建单产品体验趋势：4 个指标的月度原值 + 归一值，月份对齐，供叠加图与原值表共用。
 *
 * @param {FeedbackRecord[]} feedbacks
 * @param {string} productName
 * @param {{ limit?: number }} [options]
 * @returns {{
 *   months: string[];
 *   series: { key: string; name: string; unit: string; raw: Record<string, number | null>; normalized: Record<string, number | null>; range: { min: number | null; max: number | null } }[];
 *   hasAnyData: boolean;
 * }}
 */
export function buildProductExperienceTrend(feedbacks, productName, options = {}) {
  const limit = options.limit || 12
  const product = String(productName ?? '').trim()
  const isProduct = (/** @type {FeedbackRecord} */ r) => recordProductName(r) === product

  const complaint = (feedbacks || []).filter(
    (r) => r?.dataSourceType === 'complaint_ticket' && isProduct(r),
  )
  const consultation = (feedbacks || []).filter(
    (r) => r?.dataSourceType === 'consultation_ticket' && isProduct(r),
  )
  const postUse = (feedbacks || []).filter(
    (r) => isPostUseRatingLibraryRecord(r) && isProduct(r),
  )
  const followUp = (feedbacks || []).filter(
    (r) => isTicketSource(r?.dataSourceType) && hasFollowUpSatisfaction(r) && isProduct(r),
  )

  /** @type {Record<string, Map<string, number | null>>} */
  const rawMaps = {
    complaint: countByMonth(complaint),
    consultation: countByMonth(consultation),
    postUseScore: avgByMonth(postUse, 'ratingScore'),
    satisfaction: tenPointRateByMonth(followUp),
  }

  const allMonths = new Set()
  for (const m of Object.values(rawMaps)) for (const k of m.keys()) allMonths.add(k)
  const months = [...allMonths].sort().slice(-limit)

  const series = METRICS.map((metric) => {
    const rawMap = rawMaps[metric.key]
    const rawValues = months.map((m) => (rawMap.has(m) ? rawMap.get(m) ?? null : null))
    const finiteVals = rawValues.filter((v) => v != null)
    const min = finiteVals.length ? Math.min(...finiteVals) : null
    const max = finiteVals.length ? Math.max(...finiteVals) : null
    const normalized = normalizeTo100(rawValues)
    /** @type {Record<string, number | null>} */
    const raw = {}
    /** @type {Record<string, number | null>} */
    const norm = {}
    months.forEach((m, i) => {
      raw[m] = rawValues[i]
      norm[m] = normalized[i]
    })
    return { key: metric.key, name: metric.name, unit: metric.unit, raw, normalized: norm, range: { min, max } }
  })

  const hasAnyData = series.some((s) => Object.values(s.raw).some((v) => v != null))
  return { months, series, hasAnyData }
}
