import * as XLSX from 'xlsx'
import { getImportColumns, getImportRequiredDisplayNames } from '../domain/fieldRegistry.js'

/**
 * v2 导入分析结果表头（与导出 v2 / Field Registry 一致，16 列）。
 * @returns {string[]}
 */
export function getImportAnalysisTemplateHeaders() {
  return getImportColumns().map((field) => field.displayName)
}

/**
 * 导入分析必填列 displayName（不含排期，R1）。
 * @returns {string[]}
 */
export function getImportAnalysisRequiredHeaders() {
  return getImportRequiredDisplayNames()
}

/**
 * 下载空白 Excel 模板（首行表头）。
 * @param {string} [filename]
 */
export function downloadImportAnalysisTemplate(filename) {
  const headers = getImportAnalysisTemplateHeaders()
  const ws = XLSX.utils.aoa_to_sheet([headers])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '分析结果模板')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const name =
    filename ||
    `分析结果导入模板-v2-${headers.length}列-${new Date().toISOString().slice(0, 10)}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.xlsx') ? name : `${name}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
