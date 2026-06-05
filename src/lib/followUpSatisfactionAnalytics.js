/**
 * 回访满意度分析聚合（投诉/咨询工单 enrichment，非 post_use_rating 记录）。
 * @see docs/DESIGN-用后即评-满意度回访.md §6
 */

import {
  DISSATISFIED_REASON_ANALYSIS_DIM_KEYS,
  SATISFACTION_CALLBACK_REPORT_COLUMNS,
  getFollowUpScore,
  hasFollowUpSatisfaction,
  isMeaningfulDissatisfiedReasonValue,
  resolveFollowUpTrendMonth,
} from '../domain/followUpSatisfaction.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

export const FOLLOW_UP_ANALYTICS_VERSION = 1

/** 10 分满意率参考基线（工作台图表，可配置化二期） */
export const TEN_POINT_SATISFACTION_BASELINE = 0.88

/** @type {string[]} */
export const FOLLOW_UP_TREND_LINE_COLORS = [
  '#4F46E5',
  '#0891B2',
  '#059669',
  '#D97706',
  '#DC2626',
  '#7C3AED',
  '#DB2777',
]

const REASON_DIM_LABELS = /** @type {Record<string, string>} */ ({
  overallService: SATISFACTION_CALLBACK_REPORT_COLUMNS.overallService,
  handlingDurationScore: SATISFACTION_CALLBACK_REPORT_COLUMNS.handlingDurationScore,
  handlingDurationReason: SATISFACTION_CALLBACK_REPORT_COLUMNS.handlingDurationReason,
  staffAttitudeScore: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffAttitudeScore,
  staffAttitudeReason: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffAttitudeReason,
  staffCapabilityScore: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffCapabilityScore,
  staffCapabilityReason: SATISFACTION_CALLBACK_REPORT_COLUMNS.staffCapabilityReason,
  phoneCallbackOpinion: SATISFACTION_CALLBACK_REPORT_COLUMNS.phoneCallbackOpinion,
})

/**
 * @typedef {Object} FollowUpTenPointRateRow
 * @property {string} month YYYY-MM
 * @property {number} tenCount
 * @property {number} total
 * @property {number | null} rate 0–1
 */

/**
 * @typedef {Object} FollowUpScoreDistributionRow
 * @property {string} productKey
 * @property {string} productName
 * @property {Record<string, number>} scores keys "1".."9"
 * @property {number} lowScoreCount score <= 5
 * @property {number} nonTenTotal
 */

/**
 * @typedef {Object} FollowUpNamedCountRow
 * @property {string} name
 * @property {number} count
 */

/**
 * @typedef {Object} FollowUpReasonDimRow
 * @property {string} reasonDim
 * @property {string} label
 * @property {number} count
 */

/**
 * @typedef {Object} FollowUpUnresolvedStats
 * @property {number} unresolvedCount
 * @property {number} totalScored
 * @property {number | null} unresolvedRate
 */

/**
 * @typedef {Object} FollowUpProductOption
 * @property {string} productKey
 * @property {string} productName
 * @property {number} scoredCount
 */

/**
 * @typedef {Object} FollowUpSatisfactionMetrics
 * @property {number} version
 * @property {number} scoredCount
 * @property {FollowUpTenPointRateRow[]} tenPointRateByMonth
 * @property {FollowUpScoreDistributionRow[]} scoreDistributionByProduct
 * @property {FollowUpNamedCountRow[]} nonTenRequestScenes
 * @property {FollowUpNamedCountRow[]} nonTenProblemTypes
 * @property {FollowUpReasonDimRow[]} dissatisfiedReasons
 * @property {FollowUpUnresolvedStats} unresolved
 * @property {FollowUpProductOption[]} products
 */

/**
 * @param {FeedbackRecord} record
 */
export function productKeyFromFollowUpRecord(record) {
  return String(record.productKey || record.product || 'unknown').trim() || 'unknown'
}

/**
 * @param {FeedbackRecord} record
 */
export function productNameFromFollowUpRecord(record) {
  return (
    String(record.product?.trim() || record.productSpec?.trim() || productKeyFromFollowUpRecord(record))
  )
}

/**
 * @param {FeedbackRecord[]} records
 */
export function extractFollowUpTicketRecords(records) {
  return (records || []).filter(
    (r) =>
      (r.dataSourceType === 'complaint_ticket' || r.dataSourceType === 'consultation_ticket') &&
      hasFollowUpSatisfaction(r),
  )
}

/**
 * @param {FeedbackRecord[]} records
 */
export function filterFollowUpScoredRecords(records) {
  return extractFollowUpTicketRecords(records)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {string} [productKey]
 * @returns {FollowUpTenPointRateRow[]}
 */
export function computeTenPointRateByMonth(records, productKey) {
  let scored = filterFollowUpScoredRecords(records)
  const key = productKey?.trim()
  if (key && key !== 'all') {
    scored = scored.filter((r) => productKeyFromFollowUpRecord(r) === key)
  }

  /** @type {Map<string, { ten: number; total: number }>} */
  const byMonth = new Map()
  for (const record of scored) {
    const month = resolveFollowUpTrendMonth(record.followUpSatisfaction, record.importMonth)
    if (!month) continue
    const score = getFollowUpScore(record)
    if (score == null) continue
    const bucket = byMonth.get(month) || { ten: 0, total: 0 }
    bucket.total += 1
    if (score === 10) bucket.ten += 1
    byMonth.set(month, bucket)
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, { ten, total }]) => ({
      month,
      tenCount: ten,
      total,
      rate: total > 0 ? roundRate(ten / total) : null,
    }))
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {FollowUpScoreDistributionRow[]}
 */
export function computeScoreDistributionByProduct(records) {
  /** @type {Map<string, FollowUpScoreDistributionRow>} */
  const byProduct = new Map()

  for (const record of filterFollowUpScoredRecords(records)) {
    const score = getFollowUpScore(record)
    if (score == null || score === 10) continue

    const productKey = productKeyFromFollowUpRecord(record)
    if (!byProduct.has(productKey)) {
      byProduct.set(productKey, {
        productKey,
        productName: productNameFromFollowUpRecord(record),
        scores: emptyScoreCounts(),
        lowScoreCount: 0,
        nonTenTotal: 0,
      })
    }
    const row = byProduct.get(productKey)
    row.nonTenTotal += 1
    row.scores[String(score)] = (row.scores[String(score)] || 0) + 1
    if (score <= 5) row.lowScoreCount += 1
  }

  return [...byProduct.values()].sort((a, b) => b.nonTenTotal - a.nonTenTotal)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {'requestScene' | 'problemType'} field
 * @returns {FollowUpNamedCountRow[]}
 */
export function computeNonTenFieldDistribution(records, field) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const record of filterFollowUpScoredRecords(records)) {
    const score = getFollowUpScore(record)
    if (score == null || score === 10) continue
    const name = String(record[field] ?? '').trim() || '未分类'
    counts.set(name, (counts.get(name) || 0) + 1)
  }
  return [...counts.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

/** @param {FeedbackRecord[]} records */
export function computeNonTenRequestSceneDistribution(records) {
  return computeNonTenFieldDistribution(records, 'requestScene')
}

/** @param {FeedbackRecord[]} records */
export function computeNonTenProblemTypeDistribution(records) {
  return computeNonTenFieldDistribution(records, 'problemType')
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {FollowUpReasonDimRow[]}
 */
export function computeDissatisfiedReasonDistribution(records) {
  /** @type {Map<string, number>} */
  const counts = new Map()

  for (const record of filterFollowUpScoredRecords(records)) {
    const score = getFollowUpScore(record)
    if (score == null || score === 10) continue
    const parts = record.followUpSatisfaction?.dissatisfiedReasonParts
    if (!parts) continue
    for (const dim of DISSATISFIED_REASON_ANALYSIS_DIM_KEYS) {
      const text = String(parts[dim] ?? '').trim()
      if (!isMeaningfulDissatisfiedReasonValue(text)) continue
      counts.set(dim, (counts.get(dim) || 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([reasonDim, count]) => ({
      reasonDim,
      label: REASON_DIM_LABELS[reasonDim] || reasonDim,
      count,
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {FollowUpUnresolvedStats}
 */
export function computeUnresolvedStats(records) {
  const scored = filterFollowUpScoredRecords(records)
  let unresolvedCount = 0
  for (const record of scored) {
    if (record.followUpSatisfaction?.problemResolved === 'unresolved') {
      unresolvedCount += 1
    }
  }
  const totalScored = scored.length
  return {
    unresolvedCount,
    totalScored,
    unresolvedRate: totalScored > 0 ? roundRate(unresolvedCount / totalScored) : null,
  }
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {FollowUpProductOption[]}
 */
export function listFollowUpProductOptions(records) {
  /** @type {Map<string, FollowUpProductOption>} */
  const map = new Map()
  for (const record of filterFollowUpScoredRecords(records)) {
    const productKey = productKeyFromFollowUpRecord(record)
    const existing = map.get(productKey)
    if (existing) {
      existing.scoredCount += 1
    } else {
      map.set(productKey, {
        productKey,
        productName: productNameFromFollowUpRecord(record),
        scoredCount: 1,
      })
    }
  }
  return [...map.values()].sort((a, b) => b.scoredCount - a.scoredCount)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {{ productKey?: string }} [options]
 * @returns {FollowUpSatisfactionMetrics}
 */
export function buildFollowUpSatisfactionMetrics(records, options = {}) {
  const productKey = options.productKey?.trim()
  let scoped = filterFollowUpScoredRecords(records)
  if (productKey && productKey !== 'all') {
    scoped = scoped.filter((r) => productKeyFromFollowUpRecord(r) === productKey)
  }

  return {
    version: FOLLOW_UP_ANALYTICS_VERSION,
    scoredCount: scoped.length,
    tenPointRateByMonth: computeTenPointRateByMonth(records, productKey),
    scoreDistributionByProduct: computeScoreDistributionByProduct(scoped),
    nonTenRequestScenes: computeNonTenRequestSceneDistribution(scoped),
    nonTenProblemTypes: computeNonTenProblemTypeDistribution(scoped),
    dissatisfiedReasons: computeDissatisfiedReasonDistribution(scoped),
    unresolved: computeUnresolvedStats(scoped),
    products: listFollowUpProductOptions(records),
  }
}

/**
 * 优先读快照预聚合；缺失时实时计算。
 *
 * @param {import('../domain/snapshot.js').InsightSnapshot | null | undefined} snapshot
 * @param {FeedbackRecord[]} ticketRecords 周期内投诉/咨询工单（fallback 扫描用）
 * @param {{ productKey?: string }} [options]
 * @returns {FollowUpSatisfactionMetrics}
 */
export function resolveFollowUpSatisfactionMetrics(snapshot, ticketRecords, options = {}) {
  const cached = snapshot?.aggregates?.followUpSatisfactionMetrics
  const productKey = options.productKey?.trim()

  if (cached && typeof cached === 'object' && cached.version === FOLLOW_UP_ANALYTICS_VERSION) {
    if (!productKey || productKey === 'all') {
      return /** @type {FollowUpSatisfactionMetrics} */ (cached)
    }
    return buildFollowUpSatisfactionMetrics(ticketRecords, { productKey })
  }

  return buildFollowUpSatisfactionMetrics(ticketRecords, options)
}

/**
 * @param {string} month YYYY-MM
 */
export function formatFollowUpMonthLabel(month) {
  const raw = String(month ?? '').trim()
  const match = /^(\d{4})-(\d{1,2})$/.exec(raw)
  if (!match) return raw || '未知月份'
  return `${match[1]}年${Number(match[2])}月`
}

/**
 * 10 分满意率月度趋势（多产品折线，Y 轴为百分比 0–100）。
 *
 * @param {FeedbackRecord[]} records
 * @param {string} [productKeyFilter] 'all' 或空 = 全部产品
 * @returns {{ chartData: Record<string, unknown>[]; lines: { dataKey: string; name: string; stroke: string }[] }}
 */
export function buildTenPointRateTrendChart(records, productKeyFilter) {
  const key = productKeyFilter?.trim()
  const products = listFollowUpProductOptions(records)
  const activeProducts =
    key && key !== 'all' ? products.filter((p) => p.productKey === key) : products

  /** @type {Set<string>} */
  const months = new Set()
  /** @type {Map<string, { productName: string; rows: FollowUpTenPointRateRow[] }>} */
  const rateByProduct = new Map()

  for (const product of activeProducts) {
    const rows = computeTenPointRateByMonth(records, product.productKey)
    rateByProduct.set(product.productKey, { productName: product.productName, rows })
    for (const row of rows) months.add(row.month)
  }

  const sortedMonths = [...months].sort()
  const chartData = sortedMonths.map((month) => {
    /** @type {Record<string, unknown>} */
    const point = { month, date: formatFollowUpMonthLabel(month) }
    for (const product of activeProducts) {
      const row = rateByProduct.get(product.productKey)?.rows.find((r) => r.month === month)
      point[product.productKey] =
        row?.rate != null ? Math.round(row.rate * 1000) / 10 : null
    }
    return point
  })

  const lines = activeProducts.map((product, index) => ({
    dataKey: product.productKey,
    name: product.productName,
    stroke: FOLLOW_UP_TREND_LINE_COLORS[index % FOLLOW_UP_TREND_LINE_COLORS.length],
  }))

  return { chartData, lines }
}

function emptyScoreCounts() {
  /** @type {Record<string, number>} */
  const scores = {}
  for (let i = 1; i <= 9; i += 1) scores[String(i)] = 0
  return scores
}

/**
 * @param {number} value
 */
function roundRate(value) {
  return Math.round(value * 1000) / 1000
}
