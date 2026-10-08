import * as XLSX from 'xlsx'

/**
 * @param {string} [value]
 */
function safeFilenamePart(value) {
  const text = String(value || '').trim() || '全部产品'
  return text.replace(/[^\w\u4e00-\u9fa5-]+/g, '_').slice(0, 48)
}

/**
 * @param {Record<string, unknown>[]} rows
 * @param {string} sheetName
 * @param {string} filename
 */
function writeRows(rows, sheetName, filename) {
  const sheet = XLSX.utils.json_to_sheet(rows.length ? rows : [{ 提示: '无数据' }])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, sheet, sheetName.slice(0, 31))
  XLSX.writeFile(wb, filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`)
}

/**
 * @param {{ date: string, count: number, negative: number, ratio?: number | null, orders?: number | null }[]} rows
 * @param {{ includeRatio?: boolean, target?: number | null }} [options]
 */
export function buildComplaintVolumeWanTouExportRows(rows, options = {}) {
  const includeRatio = Boolean(options.includeRatio)
  const target = options.target
  return (rows || []).map((row) => {
    const base = {
      月份: row.date,
      工单量: row.count ?? 0,
      负向工单: row.negative ?? 0,
    }
    if (!includeRatio) return base
    return {
      ...base,
      客户体验类万投比: row.ratio == null || !Number.isFinite(Number(row.ratio)) ? '' : Number(row.ratio),
      月订单数: row.orders == null || !Number.isFinite(Number(row.orders)) ? '' : Number(row.orders),
      目标值: target == null || !Number.isFinite(Number(target)) ? '' : Number(target),
    }
  })
}

/**
 * @param {{ date: string, count: number, negative: number, negativePct?: number }[]} rows
 */
export function buildConsultationTrendExportRows(rows) {
  return (rows || []).map((row) => ({
    月份: row.date,
    工单量: row.count ?? 0,
    负向工单: row.negative ?? 0,
    '负向占比（%）': row.negativePct ?? 0,
  }))
}

/**
 * @param {{ name: string, count: number, sharePct?: number }[]} rows
 */
export function buildCustomProblemCategoryExportRows(rows) {
  return (rows || []).map((row) => ({
    '问题分类（自定义）': row.name,
    工单量: row.count ?? 0,
    '占比（%）': row.sharePct ?? 0,
  }))
}

/**
 * @param {Parameters<typeof buildComplaintVolumeWanTouExportRows>[0]} rows
 * @param {{ includeRatio?: boolean, target?: number | null, productName?: string }} [options]
 */
export function exportComplaintVolumeWanTouXlsx(rows, options = {}) {
  writeRows(
    buildComplaintVolumeWanTouExportRows(rows, options),
    '工单量及万投比',
    `客户体验类投诉工单量及万投比-${safeFilenamePart(options.productName)}.xlsx`,
  )
}

/**
 * @param {Parameters<typeof buildConsultationTrendExportRows>[0]} rows
 * @param {{ productName?: string }} [options]
 */
export function exportConsultationTrendXlsx(rows, options = {}) {
  writeRows(
    buildConsultationTrendExportRows(rows),
    '工单量及负向占比',
    `咨询工单量及负向占比-${safeFilenamePart(options.productName)}.xlsx`,
  )
}

/**
 * @param {Parameters<typeof buildCustomProblemCategoryExportRows>[0]} rows
 * @param {{ productName?: string }} [options]
 */
export function exportCustomProblemCategoryXlsx(rows, options = {}) {
  writeRows(
    buildCustomProblemCategoryExportRows(rows),
    '问题分类',
    `问题分类自定义-${safeFilenamePart(options.productName)}.xlsx`,
  )
}
