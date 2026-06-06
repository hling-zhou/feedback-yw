/**
 * 万投比：投诉工单数 / 产品订单数 × 10000
 */
import { normalizeInsightPeriod } from '../domain/insightPeriod.js'
import { isCustomerExperienceComplaint } from '../domain/complaintCause.js'
import { getWanTouTargetForYear } from '../storage/wanTouTargetStore.js'
import { getEnabledProducts, normalizeProductText } from './productCatalog.js'

/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {{ productKey: string; month: string; orderCount: number }} OrderVolumeRow */
/** @typedef {import('../storage/wanTouTargetStore.js').WanTouTargetRow} WanTouTargetRow */

/**
 * @typedef {Object} WanTouTargetEvaluation
 * @property {number | null} target
 * @property {boolean | null} met
 * @property {number | null} excessComplaints
 * @property {boolean} hasTarget
 */

/**
 * @param {FeedbackRecord[]} records
 * @param {string} month YYYY-MM
 * @param {string} [productName]
 */
export function countCustomerExperienceComplaintsInMonth(records, month, productName) {
  return records.filter((record) => {
    if (recordImportMonth(record) !== month) return false
    if (!isCustomerExperienceComplaint(record)) return false
    if (!productName) return true
    const name = record.product?.trim() || '未标注产品'
    return name === productName
  }).length
}

/**
 * @param {number | null | undefined} ratio
 * @param {number | null | undefined} target
 * @param {number | null | undefined} orders
 * @param {number} [complaints]
 * @returns {WanTouTargetEvaluation}
 */
export function evaluateWanTouTarget({ ratio, target, orders, complaints = 0 }) {
  if (target == null || !Number.isFinite(target)) {
    return { target: null, met: null, excessComplaints: null, hasTarget: false }
  }
  if (ratio == null || orders == null || orders <= 0) {
    return { target, met: null, excessComplaints: null, hasTarget: true }
  }
  const met = ratio <= target
  const excessComplaints = met
    ? 0
    : computeWanTouExcessComplaints(ratio, target, orders, complaints)
  return { target, met, excessComplaints, hasTarget: true }
}

/**
 * @param {number} ratio
 * @param {number} target
 * @param {number} orders
 * @param {number} [complaints]
 */
export function computeWanTouExcessComplaints(ratio, target, orders, complaints = 0) {
  if (!Number.isFinite(ratio) || !Number.isFinite(target) || !Number.isFinite(orders) || orders <= 0) {
    return null
  }
  if (ratio <= target) return 0
  const allowed = (target * orders) / 10000
  const byCount = Math.max(0, complaints - allowed)
  const byRatio = ((ratio - target) * orders) / 10000
  return Math.max(0, Math.ceil(Math.max(byCount, byRatio) - 1e-9))
}

/**
 * @param {boolean | null} met
 */
export function formatWanTouTargetStatus(met) {
  if (met == null) return '—'
  return met ? '达标' : '未达标'
}

/**
 * @param {number | null | undefined} ratio
 * @param {WanTouTargetEvaluation | null | undefined} evaluation
 */
export function formatWanTouRatioWithTarget(ratio, evaluation) {
  const value = formatWanTouRatio(ratio)
  if (!evaluation?.hasTarget) return value
  if (evaluation.met == null) return `${value}（待对比）`
  if (evaluation.met) return `${value}（达标）`
  const excess =
    evaluation.excessComplaints && evaluation.excessComplaints > 0
      ? `，超量 ${evaluation.excessComplaints} 单`
      : ''
  return `${value}（未达标${excess}）`
}

/**
 * @param {string} [productName]
 * @returns {string | null} catalog productKey
 */
export function resolveCatalogKeyFromProductName(productName) {
  if (!productName?.trim()) return null
  const name = productName.trim()
  for (const p of getEnabledProducts()) {
    if (p.name === name || p.key === name) return p.key
    if (normalizeProductText(p.name) === normalizeProductText(name)) return p.key
  }
  return null
}

/**
 * @param {number} year
 */
export function monthsInYear(year) {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`)
}

/**
 * @param {number} year
 * @param {number} quarter 1–4
 */
export function monthsInQuarter(year, quarter) {
  const start = (Math.min(4, Math.max(1, quarter)) - 1) * 3 + 1
  return [0, 1, 2].map((i) => `${year}-${String(start + i).padStart(2, '0')}`)
}

/**
 * @param {InsightPeriod | null | undefined} period
 * @returns {string[]} YYYY-MM
 */
export function listMonthsForPeriod(period) {
  if (!period) return [new Date().toISOString().slice(0, 7)]
  const p = normalizeInsightPeriod(period)
  const y = p.anchorYear || new Date().getFullYear()
  if (p.granularity === 'month' && p.anchorMonth) {
    return [`${y}-${String(p.anchorMonth).padStart(2, '0')}`]
  }
  if (p.granularity === 'quarter' && p.anchorQuarter) {
    return monthsInQuarter(y, p.anchorQuarter)
  }
  if (p.granularity === 'year') {
    return monthsInYear(y)
  }
  return [new Date().toISOString().slice(0, 7)]
}

/**
 * @param {FeedbackRecord} record
 */
export function recordImportMonth(record) {
  const m = record?.importMonth
  if (m && /^\d{4}-\d{2}$/.test(String(m))) return String(m).slice(0, 7)
  const created = record?.createdAt?.slice(0, 7)
  if (created && /^\d{4}-\d{2}$/.test(created)) return created
  return ''
}

/**
 * @param {FeedbackRecord[]} records
 * @param {string} month YYYY-MM
 * @param {string} [productName]
 */
export function countComplaintsInMonth(records, month, productName) {
  return records.filter((r) => {
    if (recordImportMonth(r) !== month) return false
    if (!productName) return true
    const name = r.product?.trim() || '未标注产品'
    return name === productName
  }).length
}

/**
 * @param {number} complaints
 * @param {number | null | undefined} orderCount
 * @returns {number | null}
 */
export function computeMonthlyWanTou(complaints, orderCount) {
  const orders = Number(orderCount)
  if (!Number.isFinite(orders) || orders <= 0) return null
  return (complaints / orders) * 10000
}

/**
 * @param {(number | null | undefined)[]} monthlyRatios
 * @returns {number | null}
 */
export function computeAverageWanTou(monthlyRatios) {
  const valid = monthlyRatios.filter((r) => r != null && Number.isFinite(r))
  if (!valid.length) return null
  return valid.reduce((a, b) => a + b, 0) / valid.length
}

/**
 * @param {OrderVolumeRow[]} volumes
 * @param {string} productKey
 * @param {string} month
 */
export function getOrderCountForMonth(volumes, productKey, month) {
  const row = volumes.find((v) => v.productKey === productKey && v.month === month)
  const n = Number(row?.orderCount)
  return Number.isFinite(n) && n > 0 ? n : null
}

/**
 * @param {number | null} ratio
 * @param {number} [digits]
 */
export function formatWanTouRatio(ratio, digits = 2) {
  if (ratio == null || !Number.isFinite(ratio)) return '—'
  return ratio.toFixed(digits)
}

/**
 * @param {import('../domain/enums.js').PeriodGranularity | undefined} granularity
 */
export function wanTouComparisonPeriodLabel(granularity) {
  if (granularity === 'month') return '较上月'
  if (granularity === 'quarter') return '较上季度'
  if (granularity === 'year') return '较上年'
  return '较上周期'
}

/**
 * @param {number | null | undefined} currentRatio
 * @param {number | null | undefined} previousRatio
 * @returns {number | null}
 */
export function computeWanTouPeriodDelta(currentRatio, previousRatio) {
  if (
    currentRatio == null ||
    previousRatio == null ||
    !Number.isFinite(currentRatio) ||
    !Number.isFinite(previousRatio)
  ) {
    return null
  }
  return currentRatio - previousRatio
}

/**
 * @param {number | null | undefined} delta
 * @param {number} [digits]
 */
export function formatWanTouPeriodDelta(delta, digits = 2) {
  if (delta == null || !Number.isFinite(delta)) return null
  const sign = delta > 0 ? '+' : ''
  return `${sign}${delta.toFixed(digits)}`
}

/**
 * @param {Object} params
 * @param {InsightPeriod | null | undefined} params.period
 * @param {string | null} params.productKey
 * @param {string} [params.productName]
 * @param {FeedbackRecord[]} params.records
 * @param {OrderVolumeRow[]} [params.orderVolumes]
 * @param {WanTouTargetRow[]} [params.wanTouTargets]
 */
export function buildWanTouSummary({
  period,
  productKey,
  productName,
  records,
  orderVolumes = [],
  wanTouTargets = [],
}) {
  if (!productKey) {
    return {
      productKey: null,
      productName: productName || '—',
      granularityLabel: '—',
      displayRatio: null,
      displayCxRatio: null,
      totalComplaints: 0,
      totalCxComplaints: 0,
      months: [],
      missingOrderMonths: [],
      annualTargets: null,
    }
  }

  const months = listMonthsForPeriod(period)
  const p = period ? normalizeInsightPeriod(period) : null
  const granularityLabel =
    p?.granularity === 'year'
      ? '年粒度（12 个月月均万投比）'
      : p?.granularity === 'quarter'
        ? '季粒度（季内各月月均万投比）'
        : '月粒度'

  const anchorYear = months[0] ? Number(months[0].slice(0, 4)) : new Date().getFullYear()
  const targetRow = getWanTouTargetForYear(wanTouTargets, productKey, anchorYear)

  /** @type {{
   *   month: string
   *   complaints: number
   *   cxComplaints: number
   *   orders: number | null
   *   ratio: number | null
   *   cxRatio: number | null
   *   wanTouTarget: number | null
   *   cxWanTouTarget: number | null
   *   wanTouTargetEval: WanTouTargetEvaluation
   *   cxWanTouTargetEval: WanTouTargetEvaluation
   * }[]} */
  const monthRows = months.map((month) => {
    const year = Number(month.slice(0, 4))
    const monthTargetRow = getWanTouTargetForYear(wanTouTargets, productKey, year) || targetRow
    const complaints = countComplaintsInMonth(records, month, productName)
    const cxComplaints = countCustomerExperienceComplaintsInMonth(records, month, productName)
    const orders = getOrderCountForMonth(orderVolumes, productKey, month)
    const ratio = computeMonthlyWanTou(complaints, orders)
    const cxRatio = computeMonthlyWanTou(cxComplaints, orders)
    const wanTouTarget = monthTargetRow?.wanTouTarget ?? null
    const cxWanTouTarget = monthTargetRow?.customerExperienceWanTouTarget ?? null
    return {
      month,
      complaints,
      cxComplaints,
      orders,
      ratio,
      cxRatio,
      wanTouTarget,
      cxWanTouTarget,
      wanTouTargetEval: evaluateWanTouTarget({
        ratio,
        target: wanTouTarget,
        orders,
        complaints,
      }),
      cxWanTouTargetEval: evaluateWanTouTarget({
        ratio: cxRatio,
        target: cxWanTouTarget,
        orders,
        complaints: cxComplaints,
      }),
    }
  })

  const displayRatio = computeAverageWanTou(monthRows.map((r) => r.ratio))
  const displayCxRatio = computeAverageWanTou(monthRows.map((r) => r.cxRatio))
  const totalComplaints = monthRows.reduce((n, r) => n + r.complaints, 0)
  const totalCxComplaints = monthRows.reduce((n, r) => n + r.cxComplaints, 0)
  const totalOrders = monthRows.reduce((n, r) => n + (r.orders || 0), 0)
  const missingOrderMonths = monthRows
    .filter((r) => r.complaints > 0 && (r.orders == null || r.orders <= 0))
    .map((r) => r.month)

  const wanTouTarget = targetRow?.wanTouTarget ?? null
  const cxWanTouTarget = targetRow?.customerExperienceWanTouTarget ?? null

  return {
    productKey,
    productName: productName || productKey,
    granularityLabel,
    displayRatio,
    displayCxRatio,
    totalComplaints,
    totalCxComplaints,
    months: monthRows,
    missingOrderMonths,
    annualTargets: targetRow
      ? {
          year: anchorYear,
          wanTouTarget,
          cxWanTouTarget,
        }
      : null,
    periodWanTouTargetEval: evaluateWanTouTarget({
      ratio: displayRatio,
      target: wanTouTarget,
      orders: totalOrders > 0 ? totalOrders : null,
      complaints: totalComplaints,
    }),
    periodCxWanTouTargetEval: evaluateWanTouTarget({
      ratio: displayCxRatio,
      target: cxWanTouTarget,
      orders: totalOrders > 0 ? totalOrders : null,
      complaints: totalCxComplaints,
    }),
  }
}

/**
 * @param {Object} params
 * @param {InsightPeriod | null | undefined} params.period
 * @param {FeedbackRecord[]} params.records
 * @param {OrderVolumeRow[]} [params.orderVolumes]
 * @param {WanTouTargetRow[]} [params.wanTouTargets]
 * @param {{ name: string; count?: number }[]} [params.productList]
 */
export function buildWanTouByProducts({
  period,
  records,
  orderVolumes = [],
  wanTouTargets = [],
  productList,
}) {
  const names =
    productList?.map((p) => p.name) ||
    [...new Set(records.map((r) => r.product?.trim() || '未标注产品'))]

  return names
    .map((name) => {
      const productKey = resolveCatalogKeyFromProductName(name)
      const summary = buildWanTouSummary({
        period,
        productKey,
        productName: name,
        records,
        orderVolumes,
        wanTouTargets,
      })
      return { ...summary, inCatalog: Boolean(productKey) }
    })
    .filter((row) => row.totalComplaints > 0 || row.displayRatio != null)
    .sort((a, b) => (b.displayRatio ?? -1) - (a.displayRatio ?? -1))
}
