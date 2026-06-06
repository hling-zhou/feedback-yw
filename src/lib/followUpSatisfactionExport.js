/**
 * 回访满意度分析 · Excel 导出
 * @see docs/DESIGN-用后即评-满意度回访.md §6
 */

import * as XLSX from 'xlsx'
import {
  computeTenPointRateByMonth,
  formatFollowUpMonthLabel,
  listFollowUpProductOptions,
} from './followUpSatisfactionAnalytics.js'

/** @typedef {import('./followUpSatisfactionAnalytics.js').FollowUpScoreDistributionRow} FollowUpScoreDistributionRow */
/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {string} [value]
 */
function safeFilenamePart(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .slice(0, 48)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {string} [productKeyFilter]
 */
export function buildTenPointRateTrendExportRows(records, productKeyFilter) {
  const key = productKeyFilter?.trim()
  const products = listFollowUpProductOptions(records)
  const activeProducts =
    key && key !== 'all' ? products.filter((p) => p.productKey === key) : products

  /** @type {Record<string, unknown>[]} */
  const rows = []
  for (const product of activeProducts) {
    for (const row of computeTenPointRateByMonth(records, product.productKey)) {
      rows.push({
        月份: row.month,
        月份标签: formatFollowUpMonthLabel(row.month),
        产品: product.productName,
        '10分条数': row.tenCount,
        有效回访: row.total,
        '10分满意率(%)': row.rate != null ? Math.round(row.rate * 1000) / 10 : null,
      })
    }
  }

  return rows.sort(
    (a, b) =>
      String(a.月份).localeCompare(String(b.月份)) ||
      String(a.产品).localeCompare(String(b.产品), 'zh-CN'),
  )
}

/**
 * @param {FollowUpScoreDistributionRow[]} rows
 */
export function buildScoreDistributionExportRows(rows) {
  return (rows || []).map((row) => {
    /** @type {Record<string, unknown>} */
    const exportRow = {
      产品: row.productName,
      非10分: row.nonTenTotal,
      '≤5分': row.lowScoreCount,
    }
    for (let score = 1; score <= 9; score += 1) {
      exportRow[`${score}分`] = row.scores[String(score)] || 0
    }
    return exportRow
  })
}

/**
 * @param {FeedbackRecord[]} records
 * @param {{ productKey?: string; productName?: string; periodLabel?: string }} [options]
 */
export function exportTenPointRateTrendXlsx(records, options = {}) {
  const rows = buildTenPointRateTrendExportRows(records, options.productKey)
  const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 说明: '暂无数据' }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '10分满意率趋势')
  const productPart = safeFilenamePart(options.productName || '全部产品')
  const periodPart = safeFilenamePart(options.periodLabel || '当前周期')
  const datePart = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `回访10分满意率趋势-${productPart}-${periodPart}-${datePart}.xlsx`)
}

/**
 * @param {FollowUpScoreDistributionRow[]} rows
 * @param {{ productName?: string; periodLabel?: string }} [options]
 */
export function exportScoreDistributionXlsx(rows, options = {}) {
  const exportRows = buildScoreDistributionExportRows(rows)
  const ws = XLSX.utils.json_to_sheet(
    exportRows.length ? exportRows : [{ 说明: '暂无非10分回访数据' }],
  )
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '非10分得分分布')
  const productPart = safeFilenamePart(options.productName || '全部产品')
  const periodPart = safeFilenamePart(options.periodLabel || '当前周期')
  const datePart = new Date().toISOString().slice(0, 10)
  XLSX.writeFile(wb, `回访非10分得分分布-${productPart}-${periodPart}-${datePart}.xlsx`)
}
