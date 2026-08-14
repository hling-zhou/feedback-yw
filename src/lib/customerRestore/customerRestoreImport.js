import { isTicketSource } from '../importUtils.js'
import { normalizeTicketId } from '../desensitize.js'
import {
  CUSTOMER_RESTORE_HEADER_ALIASES,
  CUSTOMER_RESTORE_PROFILE_COLUMNS,
  CUSTOMER_RESTORE_TICKET_HEADER,
} from './constants.js'

/**
 * @param {unknown} value
 */
function cell(value) {
  if (value == null) return ''
  return String(value).trim()
}

/**
 * @param {string} header
 */
export function stripRestoreHeaderSuffix(header) {
  return String(header ?? '').trim().replace(/\*+$/, '').trim()
}

/**
 * @param {string} header
 */
export function canonicalRestoreHeader(header) {
  const stripped = stripRestoreHeaderSuffix(header)
  if (!stripped) return ''
  for (const [canonical, aliases] of Object.entries(CUSTOMER_RESTORE_HEADER_ALIASES)) {
    if (stripped === canonical || aliases.includes(stripped)) return canonical
  }
  return ''
}

/**
 * @param {string} ticketId
 */
export function normalizeRestoreTicketId(ticketId) {
  return normalizeTicketId(ticketId) || cell(ticketId)
}

/**
 * @param {string[]} headers
 */
export function matchCustomerRestoreHeaders(headers) {
  const canonical = [...new Set((headers || []).map(canonicalRestoreHeader).filter(Boolean))]
  const hasTicket = canonical.includes(CUSTOMER_RESTORE_TICKET_HEADER)
  const identityHeaders = canonical.filter((name) => name !== CUSTOMER_RESTORE_TICKET_HEADER)
  const extraHeaders = (headers || [])
    .map((raw) => String(raw ?? '').trim())
    .filter((raw) => raw && !canonicalRestoreHeader(raw))
  return {
    ok: hasTicket && identityHeaders.length > 0,
    hasTicket,
    identityHeaders,
    extraHeaders,
    missingTicket: !hasTicket,
  }
}

/**
 * @param {Record<string, unknown>} rawRow
 */
export function parseCustomerRestoreRow(rawRow) {
  /** @type {Record<string, string>} */
  const fields = {}
  let ticketId = ''
  for (const [rawKey, rawValue] of Object.entries(rawRow || {})) {
    const canonical = canonicalRestoreHeader(rawKey)
    if (!canonical) continue
    const value = cell(rawValue)
    if (canonical === CUSTOMER_RESTORE_TICKET_HEADER) {
      ticketId = normalizeRestoreTicketId(value)
      continue
    }
    if (value) fields[canonical] = value
  }
  return { ticketId, fields }
}

/**
 * @param {{ headers?: string[], rows?: Record<string, unknown>[] }} input
 */
export function parseAndValidateCustomerRestoreSheet({ headers = [], rows = [] } = {}) {
  const headerMatch = matchCustomerRestoreHeaders(headers)
  if (headerMatch.missingTicket) {
    return {
      ok: false,
      fileError: '缺少必填列：工单号',
      headerMatch,
      validRows: [],
      skippedEmptyRows: 0,
      rowErrors: [{ rowIndex: 0, message: '缺少必填列：工单号' }],
    }
  }
  if (!headerMatch.identityHeaders.length) {
    return {
      ok: false,
      fileError: `除工单号外，至少需要一列客户信息（${CUSTOMER_RESTORE_PROFILE_COLUMNS.join('、')}）`,
      headerMatch,
      validRows: [],
      skippedEmptyRows: 0,
      rowErrors: [],
    }
  }
  if (!rows.length) {
    return {
      ok: false,
      fileError: '文件中没有数据行',
      headerMatch,
      validRows: [],
      skippedEmptyRows: 0,
      rowErrors: [],
    }
  }

  /** @type {Map<string, { rowIndex: number, ticketId: string, fields: Record<string, string> }>} */
  const byTicket = new Map()
  /** @type {{ rowIndex: number, message: string }[]} */
  const rowErrors = []
  let skippedEmptyRows = 0

  rows.forEach((rawRow, index) => {
    const rowIndex = index + 1
    const parsed = parseCustomerRestoreRow(rawRow)
    if (!parsed.ticketId) {
      const hasAny = Object.values(rawRow || {}).some((value) => cell(value))
      if (!hasAny) {
        skippedEmptyRows += 1
        return
      }
      rowErrors.push({ rowIndex, message: '缺少工单号' })
      return
    }
    if (!Object.keys(parsed.fields).length) {
      skippedEmptyRows += 1
      return
    }
    const prev = byTicket.get(parsed.ticketId)
    if (!prev) {
      byTicket.set(parsed.ticketId, { rowIndex, ticketId: parsed.ticketId, fields: parsed.fields })
      return
    }
    byTicket.set(parsed.ticketId, {
      rowIndex,
      ticketId: parsed.ticketId,
      fields: { ...prev.fields, ...parsed.fields },
    })
  })

  const validRows = [...byTicket.values()]
  return {
    ok: rowErrors.length === 0 && validRows.length > 0,
    fileError: validRows.length || rowErrors.length ? null : '没有可写入的客户信息行',
    headerMatch,
    validRows,
    skippedEmptyRows,
    rowErrors,
  }
}

/**
 * @param {object} record
 * @param {Record<string, string>} fields
 */
export function patchCustomerRestoreFields(record, fields) {
  const nextCols = { ...(record.sourceColumns || {}) }
  let changed = false

  for (const label of CUSTOMER_RESTORE_PROFILE_COLUMNS) {
    const value = fields[label]
    if (!value) continue
    if (nextCols[label] !== value) {
      nextCols[label] = value
      changed = true
    }
  }

  /** @type {object} */
  const next = { ...record, sourceColumns: nextCols }
  if (fields['集团名称'] && record.customerName !== fields['集团名称']) {
    next.customerName = fields['集团名称']
    changed = true
  }
  if (fields['集团客户编码'] && record.customerCode !== fields['集团客户编码']) {
    next.customerCode = fields['集团客户编码']
    changed = true
  }
  if (fields['移动云客户服务等级'] && record.customerTier !== fields['移动云客户服务等级']) {
    next.customerTier = fields['移动云客户服务等级']
    changed = true
  }

  return changed ? next : record
}

/**
 * @param {Map<string, object[]>} index
 * @param {string} key
 * @param {object} record
 */
function pushIndex(index, key, record) {
  const bucket = index.get(key)
  if (bucket) bucket.push(record)
  else index.set(key, [record])
}

/**
 * @param {object[]} records
 * @param {{ ticketId: string, fields: Record<string, string> }[]} validRows
 */
export function applyCustomerRestoreToRecords(records, validRows) {
  /** @type {Map<string, object[]>} */
  const ticketIndex = new Map()
  /** @type {Map<string, object[]>} */
  const originalTicketIndex = new Map()

  for (const record of records || []) {
    if (isTicketSource(record.dataSourceType || 'complaint_ticket')) {
      const id = normalizeRestoreTicketId(record.ticketId)
      if (id) pushIndex(ticketIndex, id, record)
      continue
    }
    if (record.dataSourceType === 'post_use_rating') {
      const id = normalizeRestoreTicketId(record.originalTicketId)
      if (id) pushIndex(originalTicketIndex, id, record)
    }
  }

  /** @type {Map<string, object>} */
  const updatedById = new Map()
  /** @type {string[]} */
  const skippedUnknownTicketIds = []
  let appliedRowCount = 0
  let skippedRowCount = 0
  let unchangedRecordCount = 0

  for (const row of validRows || []) {
    const ticketId = normalizeRestoreTicketId(row.ticketId)
    const matches = [
      ...(ticketIndex.get(ticketId) || []),
      ...(originalTicketIndex.get(ticketId) || []),
    ]
    if (!matches.length) {
      skippedUnknownTicketIds.push(ticketId)
      skippedRowCount += 1
      continue
    }
    appliedRowCount += 1
    for (const existing of matches) {
      const next = patchCustomerRestoreFields(existing, row.fields)
      if (next === existing) {
        unchangedRecordCount += 1
        continue
      }
      updatedById.set(existing.id, next)
    }
  }

  const updatedRecords = [...updatedById.values()]
  return {
    updatedRecords,
    updatedById,
    appliedRowCount,
    skippedRowCount,
    updatedRecordCount: updatedRecords.length,
    unchangedRecordCount,
    skippedUnknownTicketIds: [...new Set(skippedUnknownTicketIds.filter(Boolean))],
  }
}
