import * as XLSX from 'xlsx'
import { CUSTOMER_RESTORE_TEMPLATE_HEADERS } from './constants.js'

/**
 * 下载客户复原 Excel 模板（首行表头）。
 * @param {string} [filename]
 */
export function downloadCustomerRestoreTemplate(filename) {
  const headers = CUSTOMER_RESTORE_TEMPLATE_HEADERS
  const ws = XLSX.utils.aoa_to_sheet([headers])
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, '客户信息复原')

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const name =
    filename
    || `客户信息复原模板-${new Date().toISOString().slice(0, 10)}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.xlsx') ? name : `${name}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
