import Papa from 'papaparse'
import * as XLSX from 'xlsx'
import { detectPreset, MOBILE_CLOUD_TICKET_PRESET } from './columnPresets.js'
import { normalizeTicketId, normalizeCreatedAt } from './desensitize.js'
import { parseImportFileNamePassword } from './importFilePassword.js'

export const IMPORT_PARSE_ERROR_CODES = {
  PASSWORD_REQUIRED: 'password_required',
  PASSWORD_INCORRECT: 'password_incorrect',
  PASSWORD_UNSUPPORTED: 'password_unsupported',
}

/**
 * @param {string} code
 * @param {string} message
 * @param {unknown} [cause]
 */
function createImportParseError(code, message, cause) {
  const error = new Error(message)
  error.name = 'ImportParseError'
  // @ts-expect-error runtime-only extension for stable UI branching
  error.code = code
  // @ts-expect-error runtime-only extension for debugging
  error.cause = cause
  return error
}

/**
 * @param {unknown} err
 * @param {{ password?: string }} [options]
 */
export function normalizeExcelParseError(err, options = {}) {
  const message = err instanceof Error ? err.message : String(err ?? '解析 Excel 失败')
  const hasPassword = typeof options.password === 'string' && options.password.length > 0

  if (message.includes('Password is incorrect')) {
    return createImportParseError(
      IMPORT_PARSE_ERROR_CODES.PASSWORD_INCORRECT,
      '文件密码错误，请重新输入后重试',
      err,
    )
  }

  if (message.includes('File is password-protected')) {
    if (!hasPassword) {
      return createImportParseError(
        IMPORT_PARSE_ERROR_CODES.PASSWORD_REQUIRED,
        '该 Excel 文件已加密，请输入密码后重试',
        err,
      )
    }
    return createImportParseError(
      IMPORT_PARSE_ERROR_CODES.PASSWORD_UNSUPPORTED,
      '当前暂不支持该 Excel 文件的加密方式，请先解密后再导入',
      err,
    )
  }

  if (message.includes('Unsupported password protection')) {
    return createImportParseError(
      IMPORT_PARSE_ERROR_CODES.PASSWORD_UNSUPPORTED,
      '当前暂不支持该 Excel 文件的加密方式，请先解密后再导入',
      err,
    )
  }

  return err instanceof Error ? err : new Error(message)
}

/**
 * @typedef {Object} ColumnPreset
 * @property {string} id
 * @property {string} name
 * @property {string} [description]
 * @property {import('../domain/enums.js').DataSourceType[]} [dataSourceTypes]
 * @property {Record<string, string>} columnMap
 * @property {string[]} [rawTextMerge]
 */

/**
 * 优先使用 Excel 单元格展示文本（cell.w），避免长工单号变成科学计数法
 * @param {import('xlsx').CellObject | undefined} cell
 */
function cellValueToString(cell) {
  if (!cell) return ''
  if (cell.w != null && String(cell.w).trim() !== '') {
    return String(cell.w).trim()
  }
  if (cell.t === 'n' && typeof cell.v === 'number') {
    const v = cell.v
    if (Number.isFinite(v) && Math.floor(v) === v) {
      if (Math.abs(v) <= Number.MAX_SAFE_INTEGER) {
        return String(Math.trunc(v))
      }
      return v.toLocaleString('en-US', { useGrouping: false, maximumFractionDigits: 0 })
    }
  }
  return String(cell.v ?? '').trim()
}

/**
 * @param {import('xlsx').WorkSheet} sheet
 * @param {{ headerRowIndex?: number }} [options] 0-based row index of header (default: first used row)
 */
function sheetToRows(sheet, options = {}) {
  const ref = sheet['!ref']
  if (!ref) return { headers: [], rows: [] }

  const range = XLSX.utils.decode_range(ref)
  const headerRow =
    typeof options.headerRowIndex === 'number' && Number.isFinite(options.headerRowIndex)
      ? Math.max(range.s.r, Math.min(range.e.r, Math.trunc(options.headerRowIndex)))
      : range.s.r
  /** @type {string[]} */
  const headers = []

  for (let c = range.s.c; c <= range.e.c; c++) {
    const addr = XLSX.utils.encode_cell({ r: headerRow, c })
    let name = cellValueToString(sheet[addr])
    if (!name) name = `列${c + 1}`
    let unique = name
    let n = 2
    while (headers.includes(unique)) {
      unique = `${name}_${n++}`
    }
    headers.push(unique)
  }

  /** @type {Record<string, string>[]} */
  const rows = []
  for (let r = headerRow + 1; r <= range.e.r; r++) {
    /** @type {Record<string, string>} */
    const row = {}
    let hasValue = false
    for (let c = range.s.c; c <= range.e.c; c++) {
      const header = headers[c - range.s.c]
      const addr = XLSX.utils.encode_cell({ r, c })
      const val = cellValueToString(sheet[addr])
      if (val) hasValue = true
      row[header] = val
    }
    if (hasValue) rows.push(row)
  }

  return { headers, rows }
}

/**
 * @param {ArrayBuffer} buffer
 * @param {string} [password]
 */
function readExcelWorkbook(buffer, password) {
  try {
    return XLSX.read(buffer, {
      type: 'array',
      cellText: true,
      cellDates: true,
      password,
    })
  } catch (err) {
    throw normalizeExcelParseError(err, { password })
  }
}

/**
 * 加密文件且密码不正确时不再次尝试；其余错误在带了密码时允许无密码再读一次
 * （文件名含 # 但实际未加密）。
 *
 * @param {unknown} err
 * @param {{ password?: string; retryWithoutPassword?: boolean }} options
 */
function shouldRetryExcelWithoutPassword(err, options) {
  if (!options.retryWithoutPassword || !options.password) return false
  const code = err && typeof err === 'object' ? /** @type {{ code?: string }} */ (err).code : ''
  return (
    code !== IMPORT_PARSE_ERROR_CODES.PASSWORD_INCORRECT &&
    code !== IMPORT_PARSE_ERROR_CODES.PASSWORD_REQUIRED
  )
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ headerRowIndexBySheet?: Record<string, number>; defaultHeaderRowIndex?: number; password?: string; retryWithoutPassword?: boolean }} [options]
 * @returns {{ sheetNames: string[]; sheets: Record<string, { headers: string[]; rows: Record<string, string>[] }> }}
 */
export function parseExcelBuffer(buffer, options = {}) {
  let wb
  try {
    wb = readExcelWorkbook(buffer, options.password)
  } catch (err) {
    if (!shouldRetryExcelWithoutPassword(err, options)) throw err
    wb = readExcelWorkbook(buffer, undefined)
  }
  /** @type {Record<string, { headers: string[]; rows: Record<string, string>[] }> } */
  const sheets = {}

  for (const name of wb.SheetNames) {
    if (name === 'WpsReserved_CellImgList') continue
    const headerRowIndex =
      options.headerRowIndexBySheet?.[name] ?? options.defaultHeaderRowIndex
    const { headers, rows } = sheetToRows(wb.Sheets[name], { headerRowIndex })
    if (headers.length > 0) sheets[name] = { headers, rows }
  }

  return { sheetNames: Object.keys(sheets), sheets }
}

/**
 * @param {File} file
 * @param {{ sheetName?: string; password?: string }} [options]
 * @returns {Promise<{ headers: string[]; rows: Record<string, string>[]; sheetNames?: string[]; sheets?: Record<string, { headers: string[]; rows: Record<string, string>[] }> }>}
 */
export async function parseUploadFile(file, options = {}) {
  const fromName = parseImportFileNamePassword(file.name)
  const password = options.password || fromName.password || undefined
  const retryWithoutPassword = Boolean(fromName.password) && !options.password
  const ext = fromName.displayName.split('.').pop()?.toLowerCase() || file.name.split('.').pop()?.toLowerCase()

  if (ext === 'csv') {
    const text = await file.text()
    const result = Papa.parse(text, { header: true, skipEmptyLines: true })
    const headers = result.meta.fields || []
    const rows = /** @type {Record<string, string>[]} */ (result.data).map((row) => {
      /** @type {Record<string, string>} */
      const out = {}
      for (const [k, v] of Object.entries(row)) {
        const str = String(v ?? '').trim()
        out[k] = k.includes('工单') || k.includes('流水') ? normalizeTicketId(str) || str : str
      }
      return out
    })
    return { headers, rows }
  }

  if (ext === 'xlsx' || ext === 'xls') {
    const buffer = await file.arrayBuffer()
    const { sheetNames, sheets } = parseExcelBuffer(buffer, {
      password,
      retryWithoutPassword,
    })

    const normalizeRow = (row) => {
      /** @type {Record<string, string>} */
      const out = {}
      for (const [k, v] of Object.entries(row)) {
        const str = String(v ?? '').trim()
        if (/工单|流水|OP在线/.test(k)) {
          out[k] = normalizeTicketId(str) || str
        } else {
          out[k] = str
        }
      }
      return out
    }

    if (options.sheetName) {
      const sheet = sheets[options.sheetName]
      if (!sheet) throw new Error(`未找到工作表：${options.sheetName}`)
      return {
        headers: sheet.headers,
        rows: sheet.rows.map(normalizeRow),
        sheetNames,
        sheets,
      }
    }

    const firstName = sheetNames[0]
    const first = sheets[firstName]
    return {
      headers: first?.headers || [],
      rows: (first?.rows || []).map(normalizeRow),
      sheetNames,
      sheets,
    }
  }

  throw new Error('仅支持 .csv / .xlsx / .xls 文件')
}

/**
 * @param {Record<string, string>[]} rows
 * @param {Record<string, string>} columnMap
 * @param {string[]} [rawTextMerge]
 */
export function applyColumnMap(rows, columnMap, rawTextMerge = []) {
  return rows.map((row) => {
    /** @type {Record<string, string>} */
    const mapped = {}
    for (const [stdKey, srcCol] of Object.entries(columnMap)) {
      if (!srcCol || stdKey === 'rawTextMerge') continue
      if (row[srcCol] !== undefined) {
        let val = String(row[srcCol])
        if (stdKey === 'ticketId') {
          val = normalizeTicketId(val) || val
        }
        if (stdKey === 'createdAt') {
          val = normalizeCreatedAt(val) || val
        }
        mapped[stdKey] = val
      }
    }

    const primary = columnMap.rawText ? String(row[columnMap.rawText] ?? '') : ''
    const merged = rawTextMerge
      .filter((col) => col && row[col]?.trim())
      .map((col) => `【${col}】\n${row[col]}`)
    mapped.rawText = [primary, ...merged].filter(Boolean).join('\n\n')

    if (!mapped.ticketId) {
      const ticketCol = columnMap.ticketId || resolveTicketIdHeader(Object.keys(row))
      if (ticketCol && row[ticketCol]) {
        mapped.ticketId = normalizeTicketId(row[ticketCol]) || String(row[ticketCol])
      }
    }
    if (!mapped.createdAt && row['受理时间']) {
      mapped.createdAt = normalizeCreatedAt(row['受理时间']) || row['受理时间']
    }
    if (!mapped.productSpec && row['具体投诉产品']) {
      mapped.productSpec = row['具体投诉产品']
    }
    if (!mapped.productSpec && row['产品规格']) {
      mapped.productSpec = row['产品规格']
    }

    return mapped
  })
}

/** 工单类导入：默认工单号列（移动云工单表标准列名） */
export const PRIMARY_TICKET_ID_HEADERS = ['工单展示流水号', '工单流水号']

/** 无标准列名时的兜底候选 */
const FALLBACK_TICKET_ID_HEADERS = ['投诉工单流水号', 'OP在线工单号', '流水号', '工单号']

/** 预设未命中表头时的可选列兜底（如客户等级列名变体） */
const OPTIONAL_COLUMN_CANDIDATES = [
  { key: 'customerTierCol', candidates: ['移动云客户服务等级', '客户等级', '客户级别', '会员等级'] },
  { key: 'customerTypeNameCol', candidates: ['客户类型名称'] },
  { key: 'groupNameCol', candidates: ['集团名称'] },
  { key: 'groupCustomerCodeCol', candidates: ['集团客户编码'] },
  { key: 'groupProvinceCol', candidates: ['集团所属省份'] },
  { key: 'groupCityCol', candidates: ['集团所属地市'] },
  { key: 'loginAccountNameCol', candidates: ['登录账号名称', '登陆账号名称'] },
]

/**
 * @param {string[]} headers
 * @param {Record<string, string>} map
 */
function fillOptionalColumnCandidates(headers, map) {
  for (const { key, candidates } of OPTIONAL_COLUMN_CANDIDATES) {
    if (map[key]) continue
    const found = candidates.find((c) => headers.includes(c))
    if (found) map[key] = found
  }
  return map
}

/**
 * 解析表头中的工单号列名（优先「工单展示流水号」，其次「工单流水号」）
 * @param {string[]} headers
 */
export function resolveTicketIdHeader(headers) {
  const primary = PRIMARY_TICKET_ID_HEADERS.find((name) => headers.includes(name))
  if (primary) return primary
  return FALLBACK_TICKET_ID_HEADERS.find((name) => headers.includes(name)) || null
}

/**
 * 投诉/咨询导入：未映射工单号时默认绑定「工单展示流水号」或「工单流水号」列
 * @param {string[]} headers
 * @param {Record<string, string>} columnMap
 * @param {import('../domain/enums.js').DataSourceType} [dataSourceType]
 */
export function applyDefaultTicketIdMapping(headers, columnMap, dataSourceType = 'complaint_ticket') {
  if (dataSourceType !== 'complaint_ticket' && dataSourceType !== 'consultation_ticket') {
    return columnMap
  }
  const current = columnMap.ticketId
  if (current && headers.includes(current)) {
    return columnMap
  }
  const resolved = resolveTicketIdHeader(headers)
  if (!resolved) {
    return columnMap
  }
  return { ...columnMap, ticketId: resolved }
}

/**
 * @param {string[]} headers
 * @param {import('../domain/enums.js').DataSourceType} [dataSourceType]
 * @returns {Record<string, string>}
 */
export function guessColumnMap(headers, dataSourceType = 'complaint_ticket') {
  const preset = detectPreset(headers, dataSourceType)
  /** @type {Record<string, string>} */
  let map
  if (preset) {
    map = { ...preset.columnMap }
    for (const [key, col] of Object.entries(map)) {
      if (!headers.includes(col)) delete map[key]
    }
  } else {
    map = {}

    const rules = [
      {
        key: 'ticketId',
        candidates: [...PRIMARY_TICKET_ID_HEADERS, ...FALLBACK_TICKET_ID_HEADERS],
      },
    { key: 'createdAt', candidates: ['受理时间', '创建时间', '归档时间', '日期'] },
    {
      key: 'productSpec',
      candidates: ['具体投诉产品', '投诉产品', '产品规格', '产品名称(七级编码3)', '产品'],
    },
    { key: 'resourcePool', candidates: ['所属资源池', '资源池'] },
    ...OPTIONAL_COLUMN_CANDIDATES,
    { key: 'handlingText', candidates: ['处理意见'] },
    { key: 'rawText', candidates: ['受理内容', '追加信息', '归档意见', '详细内容'] },
    { key: 'responseText', candidates: ['优化举措/建议', '解决方案（必填）', '解决方案', '归档意见'] },
    { key: 'rootCauseCol', candidates: ['问题原因', '根因（必填）', '移动云投诉根因', '根因'] },
    { key: 'problemTypeL1FinalCol', candidates: ['投诉原因 一级（终判）'] },
    { key: 'problemTypeL2FinalCol', candidates: ['投诉原因 二级（终判）'] },
    { key: 'problemTypeL3FinalCol', candidates: ['投诉原因 三级（终判）'] },
    { key: 'source', candidates: ['受理渠道', '渠道', '来源'] },
  ]

    for (const { key, candidates } of rules) {
      if (map[key]) continue
      const found = candidates.find((c) => headers.includes(c))
      if (found) map[key] = found
    }
  }

  fillOptionalColumnCandidates(headers, map)

  return applyDefaultTicketIdMapping(headers, map, dataSourceType)
}

/**
 * @param {string[]} headers
 * @param {import('../domain/enums.js').DataSourceType} [dataSourceType]
 * @returns {string[]}
 */
export function guessRawTextMerge(headers, dataSourceType = 'complaint_ticket') {
  const preset = detectPreset(headers, dataSourceType)
  if (preset?.rawTextMerge) {
    return preset.rawTextMerge.filter((c) => headers.includes(c))
  }
  return ['处理意见', '追加信息'].filter((c) => headers.includes(c))
}

/**
 * @param {string[]} headers
 * @param {import('../domain/enums.js').DataSourceType} [dataSourceType]
 * @param {{ postUseRatingSubType?: import('../domain/postUseRatingImport.js').PostUseRatingImportSubType }} [options]
 * @returns {{ columnMap: Record<string, string>; rawTextMerge: string[]; preset: ColumnPreset | null }}
 */
export function buildMappingFromHeaders(headers, dataSourceType = 'complaint_ticket', options = {}) {
  const preset = detectPreset(headers, dataSourceType, options)
  return {
    columnMap: guessColumnMap(headers, dataSourceType),
    rawTextMerge: guessRawTextMerge(headers, dataSourceType),
    preset,
  }
}

export { MOBILE_CLOUD_TICKET_PRESET, detectPreset }
