import * as XLSX from 'xlsx'
import {
  REQUIREMENT_PROGRESS_IMPORT_HEADERS,
  REQUIREMENT_PROGRESS_SHEET_NAME,
  normalizeRequirementScheduleAt,
  normalizeRequirementTicketId,
} from '../domain/requirementTicketProgress.js'

/**
 * @typedef {import('../domain/requirementTicketProgress.js').RequirementTicketProgressRow} RequirementTicketProgressRow
 */

/**
 * @param {string} header
 */
export function normalizeRequirementProgressHeader(header) {
  return String(header ?? '')
    .replace(/\*（必填）$/, '')
    .replace(/（必填）$/, '')
    .replace(/（可选）$/, '')
    .replace(/\*$/, '')
    .trim()
}

/**
 * @param {Record<string, unknown>} row
 */
export function normalizeRequirementProgressRow(row) {
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [key, value] of Object.entries(row || {})) {
    out[normalizeRequirementProgressHeader(key)] = value
  }
  return out
}

/**
 * @param {unknown} value
 */
function cellToText(value) {
  if (value == null) return ''
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const y = value.getFullYear()
    const m = String(value.getMonth() + 1).padStart(2, '0')
    const d = String(value.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }
  return String(value).trim()
}

/**
 * @param {ArrayBuffer} buffer
 */
export function parseRequirementProgressWorkbook(buffer) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName =
    wb.SheetNames.find((name) => name === REQUIREMENT_PROGRESS_SHEET_NAME) || wb.SheetNames[0]
  const rawRows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })

  /** @type {import('../../server/requirementTicketProgressRepository.js').RequirementTicketProgressImportRow[]} */
  const rows = []
  /** @type {{ row: number; message: string }[]} */
  const errors = []

  rawRows.forEach((raw, index) => {
    const row = normalizeRequirementProgressRow(/** @type {Record<string, unknown>} */ (raw))
    const ticketId = normalizeRequirementTicketId(cellToText(row['需求工单号']))
    if (!ticketId) {
      const hasOther = REQUIREMENT_PROGRESS_IMPORT_HEADERS.some((key) => cellToText(row[key]))
      if (hasOther) errors.push({ row: index + 2, message: '需求工单号不能为空' })
      return
    }
    const scheduleRaw = cellToText(row['排期时间'])
    const scheduleAt = normalizeRequirementScheduleAt(scheduleRaw)
    if (scheduleRaw && !scheduleAt) {
      errors.push({ row: index + 2, message: `工单 ${ticketId} 排期时间无法解析` })
      return
    }
    rows.push({
      ticketId,
      product: cellToText(row['产品']),
      scheduleAt,
      workflowStatus: cellToText(row['状态']),
    })
  })

  return { rows, errors }
}

/**
 * @returns {ArrayBuffer}
 */
export function buildRequirementProgressTemplateBuffer() {
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet([
    REQUIREMENT_PROGRESS_IMPORT_HEADERS,
    ['REQ-001', 'VPC', '2026-06-30', '开发中'],
  ])
  XLSX.utils.book_append_sheet(wb, ws, REQUIREMENT_PROGRESS_SHEET_NAME)
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
}
