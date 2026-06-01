/**
 * 分析结果导入 — 表头匹配、行校验（P3-2）；写入见 P3-3 applyImportReplace。
 */

import {
  getImportColumns,
  getImportDisplayNameToFieldKey,
  getImportRequiredDisplayNames,
} from '../domain/fieldRegistry.js'
import {
  OVERRIDE_POLICY,
  applyOverridePolicy,
  parseImportSentiment,
  parseImportUrgency,
} from '../domain/overridePolicy.js'
import { normalizeTicketId } from './desensitize.js'
import { SENTIMENT_LABELS } from './sentiment.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/** @typedef {import('../domain/fieldRegistry.js').FieldDefinition} FieldDefinition */

/**
 * @typedef {Object} ImportAnalysisHeaderMatch
 * @property {boolean} ok
 * @property {string[]} requiredHeaders
 * @property {string[]} missingHeaders
 * @property {string[]} matchedHeaders
 * @property {string[]} extraHeaders
 */

/**
 * @typedef {Object} ImportAnalysisRowError
 * @property {number} rowIndex - 1-based 数据行号（Excel 第 2 行 = 1）
 * @property {string} fieldKey
 * @property {string} displayName
 * @property {string} message
 */

/**
 * @typedef {Object} ImportAnalysisValidatedRow
 * @property {number} rowIndex
 * @property {string} ticketId
 * @property {Record<string, string>} byDisplayName - 供 applyImportReplace 使用
 * @property {Record<string, string | import('./sentiment.js').Sentiment | import('./sentiment.js').UrgencyLevel>} byFieldKey
 */

/**
 * @typedef {Object} ImportAnalysisValidationResult
 * @property {boolean} ok
 * @property {string | null} fileError
 * @property {ImportAnalysisHeaderMatch} headerMatch
 * @property {ImportAnalysisValidatedRow[]} validRows
 * @property {ImportAnalysisRowError[]} rowErrors
 */

const SENTIMENT_LABEL_TO_KEY = Object.fromEntries(
  Object.entries(SENTIMENT_LABELS).map(([key, label]) => [label, key]),
)

const URGENT_IMPORT_TEXT = /^(?:是|加急|高|yes|true|1)$/i

/** 导入时读取表头/单元格但不写入库内（自动优化建议由打标生成）。 */
export const IMPORT_SKIP_WRITE_FIELD_KEYS = new Set(['optimizationProduct', 'optimizationService'])

/**
 * 去掉模板必填标记（列名末尾 *）。
 * @param {string} header
 */
export function stripImportHeaderSuffix(header) {
  return String(header ?? '')
    .trim()
    .replace(/\*+$/, '')
    .trim()
}

/**
 * @param {string[]} headers
 * @returns {Record<string, string>} 原始表头 → Registry displayName
 */
export function buildImportHeaderAliasMap(headers) {
  const knownNames = new Set(getImportColumns().map((f) => f.displayName))
  /** @type {Record<string, string>} */
  const aliasToDisplay = {}
  for (const raw of headers || []) {
    const trimmed = String(raw ?? '').trim()
    if (!trimmed) continue
    const stripped = stripImportHeaderSuffix(trimmed)
    if (knownNames.has(stripped)) aliasToDisplay[trimmed] = stripped
    else if (knownNames.has(trimmed)) aliasToDisplay[trimmed] = trimmed
  }
  return aliasToDisplay
}

/**
 * @param {Record<string, string | undefined>} rawRow
 * @param {Record<string, string>} aliasMap
 */
export function remapImportRowByHeaderAliases(rawRow, aliasMap) {
  /** @type {Record<string, string | undefined>} */
  const remapped = {}
  for (const [key, value] of Object.entries(rawRow || {})) {
    const trimmedKey = String(key ?? '').trim()
    const displayName =
      aliasMap[trimmedKey] ||
      (() => {
        const stripped = stripImportHeaderSuffix(trimmedKey)
        return getImportColumns().some((f) => f.displayName === stripped) ? stripped : ''
      })()
    if (displayName) remapped[displayName] = value
  }
  return remapped
}

/**
 * @param {string[]} headers
 * @returns {ImportAnalysisHeaderMatch}
 */
export function matchImportAnalysisHeaders(headers) {
  const knownNames = new Set(getImportColumns().map((f) => f.displayName))
  const requiredHeaders = getImportRequiredDisplayNames()
  const normalized = (headers || [])
    .map((h) => stripImportHeaderSuffix(h))
    .filter(Boolean)

  /** @type {string[]} */
  const matchedHeaders = []
  /** @type {string[]} */
  const extraHeaders = []

  for (const header of normalized) {
    if (knownNames.has(header)) matchedHeaders.push(header)
    else extraHeaders.push(header)
  }

  const missingHeaders = requiredHeaders.filter((name) => !normalized.includes(name))

  return {
    ok: missingHeaders.length === 0,
    requiredHeaders,
    missingHeaders,
    matchedHeaders,
    extraHeaders,
  }
}

/**
 * @param {string | undefined} raw
 * @returns {{ ok: true } | { ok: false; message: string }}
 */
export function validateImportSentimentRaw(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: false, message: '不能为空' }
  if (text in SENTIMENT_LABELS) return { ok: true }
  if (SENTIMENT_LABEL_TO_KEY[text]) return { ok: true }
  if (text === 'neutral' || text === 'urgent') return { ok: true }
  return { ok: false, message: `无法识别用户情绪「${text}」` }
}

/**
 * @param {string | undefined} raw
 * @returns {{ ok: true } | { ok: false; message: string }}
 */
export function validateImportUrgencyRaw(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return { ok: true }
  if (URGENT_IMPORT_TEXT.test(text)) return { ok: true }
  if (text === 'none' || text === 'high') return { ok: true }
  return { ok: false, message: `无法识别是否加急「${text}」` }
}

/**
 * @param {FieldDefinition} field
 * @returns {boolean}
 */
function isImportCellValueRequired(field) {
  return field.importRequired !== false
}

/**
 * 从原始行（文件表头 → 单元格）提取已知导入列。
 *
 * @param {Record<string, string | undefined>} rawRow
 * @returns {Record<string, string>}
 */
export function normalizeImportAnalysisRow(rawRow) {
  /** @type {Record<string, string>} */
  const byDisplayName = {}
  for (const field of getImportColumns()) {
    const raw = rawRow[field.displayName]
    byDisplayName[field.displayName] = raw == null ? '' : String(raw).trim()
  }
  return byDisplayName
}

/**
 * @param {Record<string, string>} byDisplayName
 * @returns {Record<string, string | import('./sentiment.js').Sentiment | import('./sentiment.js').UrgencyLevel>}
 */
export function coerceImportAnalysisRow(byDisplayName) {
  /** @type {Record<string, string | import('./sentiment.js').Sentiment | import('./sentiment.js').UrgencyLevel>} */
  const byFieldKey = {}
  for (const field of getImportColumns()) {
    const raw = byDisplayName[field.displayName]
    switch (field.fieldKey) {
      case 'sentiment':
        byFieldKey[field.fieldKey] = parseImportSentiment(raw)
        break
      case 'urgency':
        byFieldKey[field.fieldKey] = parseImportUrgency(raw)
        break
      default:
        byFieldKey[field.fieldKey] = raw == null ? '' : String(raw).trim()
        break
    }
  }
  return byFieldKey
}

/**
 * @param {Record<string, string | undefined>} rawRow
 * @param {number} rowIndex - 1-based 数据行号
 * @returns {{ valid: true; row: ImportAnalysisValidatedRow } | { valid: false; errors: ImportAnalysisRowError[] }}
 */
export function validateImportAnalysisRow(rawRow, rowIndex) {
  const byDisplayName = normalizeImportAnalysisRow(rawRow)
  /** @type {ImportAnalysisRowError[]} */
  const errors = []

  for (const field of getImportColumns()) {
    const raw = byDisplayName[field.displayName]

    if (isImportCellValueRequired(field) && !String(raw ?? '').trim()) {
      errors.push({
        rowIndex,
        fieldKey: field.fieldKey,
        displayName: field.displayName,
        message: '不能为空',
      })
      continue
    }

    if (field.fieldKey === 'sentiment' && String(raw ?? '').trim()) {
      const sentimentCheck = validateImportSentimentRaw(raw)
      if (!sentimentCheck.ok) {
        errors.push({
          rowIndex,
          fieldKey: field.fieldKey,
          displayName: field.displayName,
          message: sentimentCheck.message,
        })
      }
    }

    if (field.fieldKey === 'urgency' && String(raw ?? '').trim()) {
      const urgencyCheck = validateImportUrgencyRaw(raw)
      if (!urgencyCheck.ok) {
        errors.push({
          rowIndex,
          fieldKey: field.fieldKey,
          displayName: field.displayName,
          message: urgencyCheck.message,
        })
      }
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors }
  }

  const byFieldKey = coerceImportAnalysisRow(byDisplayName)
  const ticketId = String(byFieldKey.ticketId ?? '').trim()

  return {
    valid: true,
    row: {
      rowIndex,
      ticketId,
      byDisplayName,
      byFieldKey,
    },
  }
}

/**
 * @param {Record<string, string>[]} rows
 * @param {{ headers?: string[] }} [options]
 * @returns {ImportAnalysisValidationResult}
 */
export function parseAndValidateImportAnalysisSheet({ headers = [], rows = [] }) {
  const aliasMap = buildImportHeaderAliasMap(headers)
  const normalizedHeaders = (headers || [])
    .map((h) => aliasMap[String(h ?? '').trim()] || stripImportHeaderSuffix(h))
    .filter(Boolean)
  const headerMatch = matchImportAnalysisHeaders(normalizedHeaders)

  if (!headerMatch.ok) {
    return {
      ok: false,
      fileError: `缺少必填列：${headerMatch.missingHeaders.join('、')}`,
      headerMatch,
      validRows: [],
      rowErrors: [],
    }
  }

  if (!rows.length) {
    return {
      ok: false,
      fileError: '文件中没有数据行',
      headerMatch,
      validRows: [],
      rowErrors: [],
    }
  }

  /** @type {ImportAnalysisValidatedRow[]} */
  const validRows = []
  /** @type {ImportAnalysisRowError[]} */
  const rowErrors = []

  rows.forEach((rawRow, index) => {
    const remapped = remapImportRowByHeaderAliases(rawRow, aliasMap)
    const result = validateImportAnalysisRow(remapped, index + 1)
    if (result.valid) validRows.push(result.row)
    else rowErrors.push(...result.errors)
  })

  return {
    ok: rowErrors.length === 0,
    fileError: null,
    headerMatch,
    validRows,
    rowErrors,
  }
}

/**
 * 表头 displayName → fieldKey（便于 UI 展示）。
 * @returns {Record<string, string>}
 */
export function getImportAnalysisHeaderFieldMap() {
  return getImportDisplayNameToFieldKey()
}

/**
 * @typedef {Object} ImportAnalysisApplyResult
 * @property {FeedbackRecord[]} updatedRecords
 * @property {Map<string, FeedbackRecord>} updatedById
 * @property {number} appliedRowCount - 导入行中成功匹配库内的行数
 * @property {number} skippedRowCount - 导入行中未匹配库内的行数
 * @property {number} updatedRecordCount - 实际写入的记录条数（同工单号可能多条）
 * @property {string[]} skippedUnknownTicketIds
 */

/**
 * @param {string | undefined} ticketId
 * @returns {string}
 */
export function normalizeImportAnalysisTicketId(ticketId) {
  return normalizeTicketId(ticketId) || String(ticketId ?? '').trim()
}

/**
 * 工单号 → 库内记录列表（R3 匹配用）。
 *
 * @param {FeedbackRecord[]} records
 * @returns {Map<string, FeedbackRecord[]>}
 */
export function buildTicketIdIndex(records) {
  /** @type {Map<string, FeedbackRecord[]>} */
  const index = new Map()
  for (const record of records) {
    const ticketId = normalizeImportAnalysisTicketId(record.ticketId)
    if (!ticketId) continue
    const bucket = index.get(ticketId)
    if (bucket) bucket.push(record)
    else index.set(ticketId, [record])
  }
  return index
}

/**
 * 将校验通过的导入行按 IMPORT_REPLACE 写入已有记录（R3：未匹配跳过）。
 *
 * @param {FeedbackRecord[]} existingRecords - 库内全量或待匹配集合
 * @param {ImportAnalysisValidatedRow[]} validRows
 * @returns {ImportAnalysisApplyResult}
 */
export function applyImportAnalysisToRecords(existingRecords, validRows) {
  const index = buildTicketIdIndex(existingRecords)
  /** @type {Map<string, FeedbackRecord>} */
  const updatedById = new Map()
  /** @type {string[]} */
  const skippedUnknownTicketIds = []
  let appliedRowCount = 0
  let skippedRowCount = 0

  for (const row of validRows) {
    const ticketId = normalizeImportAnalysisTicketId(row.ticketId)
    const matches = index.get(ticketId)
    if (!matches?.length) {
      skippedUnknownTicketIds.push(ticketId)
      skippedRowCount += 1
      continue
    }

    appliedRowCount += 1
    for (const existing of matches) {
      const next = applyOverridePolicy(existing, OVERRIDE_POLICY.IMPORT_REPLACE, {
        importRow: row.byDisplayName,
      })
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
    skippedUnknownTicketIds: [...new Set(skippedUnknownTicketIds.filter(Boolean))],
  }
}
