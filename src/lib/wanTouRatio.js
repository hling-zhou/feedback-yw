/**
 * 万投比：投诉工单数 / 产品订单数 × 10000
 */
import { normalizeInsightPeriod } from '../domain/insightPeriod.js'
import { getEnabledProducts, normalizeProductText } from './productCatalog.js'

/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {{ productKey: string; month: string; orderCount: number }} OrderVolumeRow */

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
 */
export function buildWanTouSummary({
  period,
  productKey,
  productName,
  records,
  orderVolumes = [],
}) {
  if (!productKey) {
    return {
      productKey: null,
      productName: productName || '—',
      granularityLabel: '—',
      displayRatio: null,
      totalComplaints: 0,
      months: [],
      missingOrderMonths: [],
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

  /** @type {{ month: string; complaints: number; orders: number | null; ratio: number | null }[]} */
  const monthRows = months.map((month) => {
    const complaints = countComplaintsInMonth(records, month, productName)
    const orders = getOrderCountForMonth(orderVolumes, productKey, month)
    const ratio = computeMonthlyWanTou(complaints, orders)
    return { month, complaints, orders, ratio }
  })

  const displayRatio = computeAverageWanTou(monthRows.map((r) => r.ratio))
  const totalComplaints = monthRows.reduce((n, r) => n + r.complaints, 0)
  const missingOrderMonths = monthRows
    .filter((r) => r.complaints > 0 && (r.orders == null || r.orders <= 0))
    .map((r) => r.month)

  return {
    productKey,
    productName: productName || productKey,
    granularityLabel,
    displayRatio,
    totalComplaints,
    months: monthRows,
    missingOrderMonths,
  }
}

/**
 * @param {Object} params
 * @param {InsightPeriod | null | undefined} params.period
 * @param {FeedbackRecord[]} params.records
 * @param {OrderVolumeRow[]} [params.orderVolumes]
 * @param {{ name: string; count?: number }[]} [params.productList]
 */
export function buildWanTouByProducts({ period, records, orderVolumes = [], productList }) {
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
      })
      return { ...summary, inCatalog: Boolean(productKey) }
    })
    .filter((row) => row.totalComplaints > 0 || row.displayRatio != null)
    .sort((a, b) => (b.displayRatio ?? -1) - (a.displayRatio ?? -1))
}
