import * as XLSX from 'xlsx'
import {
  ACTION_ITEM_STATUS_LABELS,
  ACTION_ITEM_STATUSES,
  deriveActionItemStatusFromSchedule,
  isActionItemStatus,
  validateActionItemCreate,
} from '../domain/actionItem.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { normalizeActionSchedule } from '../domain/actionSchedule.js'
import { ACTION_ITEM_LIST_SHEET_NAME } from './actionItemExport.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/** @type {Record<string, DataSourceType>} */
const DATA_SOURCE_BY_LABEL = Object.fromEntries(
  Object.entries(DATA_SOURCE_LABELS).map(([key, label]) => [label, /** @type {DataSourceType} */ (key)]),
)

/** @type {Record<string, import('../domain/actionItem.js').ActionItemStatus>} */
const STATUS_BY_LABEL = Object.fromEntries(
  ACTION_ITEM_STATUSES.map((status) => [ACTION_ITEM_STATUS_LABELS[status], status]),
)

const LINKED_TICKET_HEADERS = ['关联工单', '关联工单(本周期)', '关联工单号']

/**
 * @param {string} text
 * @returns {string[]}
 */
export function parseLinkedTicketIdsCell(text) {
  return String(text ?? '')
    .split(/[\n,，;；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
}

/**
 * @param {string} text
 * @returns {DataSourceType[]}
 */
export function parseLinkedDataSourcesCell(text) {
  const raw = String(text ?? '').trim()
  if (!raw) return []

  /** @type {DataSourceType[]} */
  const out = []
  for (const part of raw.split(/[、,，;；]+/)) {
    const token = part.trim()
    if (!token) continue
    const byLabel = DATA_SOURCE_BY_LABEL[token]
    if (byLabel && !out.includes(byLabel)) {
      out.push(byLabel)
      continue
    }
    if (Object.prototype.hasOwnProperty.call(DATA_SOURCE_LABELS, token) && !out.includes(/** @type {DataSourceType} */ (token))) {
      out.push(/** @type {DataSourceType} */ (token))
    }
  }
  return out
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} header
 */
function cell(row, header) {
  const value = row[header]
  if (value == null) return ''
  return String(value).trim()
}

/**
 * @param {Record<string, unknown>} row
 * @param {string[]} headers
 */
function cellAny(row, headers) {
  for (const header of headers) {
    const value = cell(row, header)
    if (value) return value
  }
  return ''
}

/**
 * @param {Record<string, unknown>} row
 * @param {{ productNameToKey?: Map<string, string>; firstProposedAt?: string }} [options]
 * @returns {{ ok: true; item: Partial<ActionItem> } | { ok: false; error: string }}
 */
export function parseActionItemImportRow(row, options = {}) {
  const content = cell(row, '举措')
  if (!content) return { ok: false, error: '缺少举措内容' }

  const productName = cell(row, '产品名称')
  const productKeyFromMap = productName ? options.productNameToKey?.get(productName) : undefined

  const scheduleAt = normalizeActionSchedule(cell(row, '排期时间'))
  const statusLabel = cell(row, '状态')
  let status = STATUS_BY_LABEL[statusLabel]
  if (statusLabel && !status && isActionItemStatus(statusLabel)) {
    status = statusLabel
  }
  if (!status) {
    status = deriveActionItemStatusFromSchedule(scheduleAt)
  }

  const linkedTicketIds = parseLinkedTicketIdsCell(cellAny(row, LINKED_TICKET_HEADERS))
  const linkedDataSources = parseLinkedDataSourcesCell(cell(row, '来源'))

  const validated = validateActionItemCreate({
    content,
    productName,
    productKey: productKeyFromMap || '',
    painPointSnapshot: cell(row, '问题'),
    problemTypeSnapshot: cell(row, '问题类型'),
    journeyL1Snapshot: cell(row, '用户旅程一级'),
    scheduleAt,
    status,
    linkedTicketIds,
    linkedDataSources,
    firstProposedAt: options.firstProposedAt || new Date().toISOString().slice(0, 10),
  })

  if (!validated.ok) return validated
  return { ok: true, item: validated.item }
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ productNameToKey?: Map<string, string>; firstProposedAt?: string }} [options]
 */
export function parseActionItemImportWorkbook(buffer, options = {}) {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true })
  const sheetName =
    wb.SheetNames.find((name) => name === ACTION_ITEM_LIST_SHEET_NAME) || wb.SheetNames[0]
  if (!sheetName) {
    return { rows: [], errors: [{ row: 0, error: '文件中没有工作表' }] }
  }

  const rawRows = /** @type {Record<string, unknown>[]} */ (
    XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { defval: '' })
  )

  /** @type {Partial<ActionItem>[]} */
  const rows = []
  /** @type {{ row: number; error: string }[]} */
  const errors = []

  rawRows.forEach((row, index) => {
    const excelRow = index + 2
    const hint = cell(row, '提示')
    if (hint === '无数据') return
    const content = cell(row, '举措')
    const productName = cell(row, '产品名称')
    if (!content && !productName) return

    const parsed = parseActionItemImportRow(row, options)
    if (!parsed.ok) {
      errors.push({ row: excelRow, error: parsed.error })
      return
    }
    rows.push(parsed.item)
  })

  return { rows, errors }
}

/**
 * @param {{ name: string; key: string }[]} products
 */
export function buildProductNameToKeyMap(products) {
  /** @type {Map<string, string>} */
  const map = new Map()
  for (const product of products || []) {
    if (product.name) map.set(product.name, product.key)
  }
  return map
}
