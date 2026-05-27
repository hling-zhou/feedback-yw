/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

const MAX_FILE_BYTES = 20 * 1024 * 1024
const MAX_ROWS = 5000
const ALLOWED_EXT = ['.csv', '.xlsx', '.xls']

/**
 * @param {DataSourceType} dataSourceType
 */
export function isTicketSource(dataSourceType) {
  return dataSourceType === 'complaint_ticket' || dataSourceType === 'consultation_ticket'
}

/**
 * @param {File} file
 */
export function validateImportFile(file) {
  const name = (file.name || '').toLowerCase()
  const ext = ALLOWED_EXT.find((e) => name.endsWith(e))
  if (!ext) {
    return { ok: false, message: '仅支持 .csv、.xlsx、.xls 文件' }
  }
  if (name.endsWith('.xlsm')) {
    return { ok: false, message: '不支持含宏的 .xlsm 文件' }
  }
  if (file.size > MAX_FILE_BYTES) {
    return { ok: false, message: `文件超过 ${MAX_FILE_BYTES / 1024 / 1024}MB 上限` }
  }
  return { ok: true }
}

/**
 * @param {number} rowCount
 */
export function validateRowCount(rowCount) {
  if (rowCount > MAX_ROWS) {
    return { ok: false, message: `单次导入上限 ${MAX_ROWS} 条` }
  }
  return { ok: true }
}

/**
 * @param {File} file
 * @returns {Promise<string>}
 */
export async function hashFileSha256(file) {
  const buffer = await file.arrayBuffer()
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', buffer)
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
  }
  return `size:${file.size}:name:${file.name}`
}

/**
 * @param {DataSourceType} dataSourceType
 * @param {string} month
 */
/**
 * @param {string} [value]
 * @returns {string | null} YYYY-MM
 */
export function normalizeImportMonth(value) {
  const v = String(value || '').trim()
  if (!/^\d{4}-\d{2}$/.test(v)) return null
  const [y, m] = v.split('-').map(Number)
  if (!y || m < 1 || m > 12) return null
  return `${y}-${String(m).padStart(2, '0')}`
}

/**
 * 从导入行提取批次/数据月份元数据（写入记录 SSOT）
 * @param {Record<string, unknown>} [row]
 */
export function pickImportRowMeta(row) {
  if (!row) return {}
  const meta = {
    importMonth: normalizeImportMonth(/** @type {string} */ (row.importMonth)),
    importBatchId: row.importBatchId,
    importBatchName: row.importBatchName,
    importFileName: row.importFileName,
    importSheetName: row.importSheetName,
    importedAt: row.importedAt,
  }
  return Object.fromEntries(
    Object.entries(meta).filter(([, val]) => val != null && val !== ''),
  )
}

export function defaultBatchName(dataSourceType, month) {
  const labels = {
    complaint_ticket: '投诉工单导入',
    consultation_ticket: '咨询工单导入',
    post_use_rating: '用后即评导入',
    user_survey: '用户调研导入',
    other: '其他反馈导入',
  }
  return `${month || ''} ${labels[dataSourceType] || '数据导入'}`.trim()
}

/**
 * @param {DataSourceType} dataSourceType
 */
export function preferredSheetName(dataSourceType, sheetNames) {
  if (!sheetNames?.length) return sheetNames?.[0]
  if (dataSourceType === 'complaint_ticket') {
    return (
      sheetNames.find((n) => n.includes('投诉') && !n.includes('压降')) || sheetNames[0]
    )
  }
  if (dataSourceType === 'consultation_ticket') {
    return sheetNames.find((n) => n.includes('咨询')) || sheetNames[0]
  }
  return sheetNames[0]
}
