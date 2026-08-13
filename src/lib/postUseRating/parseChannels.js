/**
 * 用后即评渠道解析与规范化
 */
import { parseExcelBuffer } from '../parseFile.js'
import { parseYesNo } from '../../domain/followUpSatisfaction.js'

/** @typedef {'sms' | 'console' | 'callback' | 'option'} PostUseChannel */

/**
 * @typedef {Object} NormalizedPostUseRow
 * @property {PostUseChannel} channel
 * @property {string} productName
 * @property {number} score
 * @property {string} customerName
 * @property {string} customerCode
 * @property {string} answeredAt
 * @property {string} [rawComment]
 * @property {string} [lowScoreReason]
 * @property {string[]} [feedbackReasonTexts]
 * @property {string} [scene]
 * @property {string} [followUpTicketId]
 * @property {string} [originalTicketId]
 * @property {Record<string, string>} [raw]
 */

export const SMS_SHEET_NAME = '短信渠道用后即评明细数据'
export const WEB_SCORE_SHEET = '评分类'
export const WEB_OPTION_SHEET = '选项类'
export const WEB_CALLBACK_SHEET = '投诉处理-电话回访'

const SCORE_COL_CALLBACK = '请您对本次投诉的整体服务情况进行评价'

/**
 * @param {string | undefined | null} text
 */
function cell(text) {
  return String(text ?? '').trim()
}

/**
 * @param {unknown} value
 * @returns {number | null}
 */
export function parseScore(value) {
  if (value == null || value === '') return null
  const n = Number(String(value).trim().replace(/,/g, ''))
  if (!Number.isFinite(n)) return null
  return n
}

/**
 * @param {string[]} sheetNames
 * @param {string} prefer
 */
function findSheetName(sheetNames, prefer) {
  if (sheetNames.includes(prefer)) return prefer
  const hit = sheetNames.find((n) => n.includes(prefer) || prefer.includes(n))
  return hit || ''
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ password?: string; retryWithoutPassword?: boolean }} [options]
 */
export function parseSmsChannelWorkbook(buffer, options = {}) {
  const { sheetNames, sheets } = parseExcelBuffer(buffer, {
    defaultHeaderRowIndex: 2,
    password: options.password,
    retryWithoutPassword: options.retryWithoutPassword,
  })
  const name = findSheetName(sheetNames, SMS_SHEET_NAME) || sheetNames[0]
  const sheet = name ? sheets[name] : null
  if (!sheet) {
    return { sheetName: '', headers: [], rows: [], error: '未找到短信渠道 Sheet' }
  }
  return { sheetName: name, headers: sheet.headers, rows: sheet.rows, error: '' }
}

/**
 * @param {ArrayBuffer} buffer
 * @param {{ password?: string; retryWithoutPassword?: boolean }} [options]
 */
export function parseOfficialChannelWorkbook(buffer, options = {}) {
  const { sheetNames, sheets } = parseExcelBuffer(buffer, {
    password: options.password,
    retryWithoutPassword: options.retryWithoutPassword,
  })
  const scoreName = findSheetName(sheetNames, WEB_SCORE_SHEET)
  const optionName = findSheetName(sheetNames, WEB_OPTION_SHEET)
  const callbackName = findSheetName(sheetNames, WEB_CALLBACK_SHEET)
  return {
    sheetNames,
    score: scoreName ? sheets[scoreName] : null,
    option: optionName ? sheets[optionName] : null,
    callback: callbackName ? sheets[callbackName] : null,
    scoreSheetName: scoreName,
    optionSheetName: optionName,
    callbackSheetName: callbackName,
    error: !scoreName && !callbackName ? '未找到评分类或投诉处理-电话回访 Sheet' : '',
  }
}

/**
 * @param {ReturnType<typeof parseSmsChannelWorkbook>[]} results
 */
export function mergeSmsChannelWorkbooks(results) {
  const list = results || []
  const failed = list.find((item) => item?.error)
  if (failed) return failed
  if (!list.length) {
    return { sheetName: '', headers: [], rows: [], error: '未找到短信渠道 Sheet' }
  }
  return {
    sheetName: [...new Set(list.map((item) => item.sheetName).filter(Boolean))].join('、'),
    headers: list[0].headers || [],
    rows: list.flatMap((item) => item.rows || []),
    error: '',
  }
}

/**
 * @param {ReturnType<typeof parseOfficialChannelWorkbook>[]} results
 */
export function mergeOfficialChannelWorkbooks(results) {
  const list = results || []
  const failed = list.find((item) => item?.error)
  if (failed) return failed
  if (!list.length) {
    return {
      sheetNames: [],
      score: null,
      option: null,
      callback: null,
      scoreSheetName: '',
      optionSheetName: '',
      callbackSheetName: '',
      error: '未找到评分类或投诉处理-电话回访 Sheet',
    }
  }

  const concatSheet = (key) => {
    const parts = list.map((item) => item[key]).filter(Boolean)
    if (!parts.length) return null
    return {
      headers: parts[0].headers || [],
      rows: parts.flatMap((part) => part.rows || []),
    }
  }

  const score = concatSheet('score')
  const option = concatSheet('option')
  const callback = concatSheet('callback')
  return {
    sheetNames: [...new Set(list.flatMap((item) => item.sheetNames || []))],
    score,
    option,
    callback,
    scoreSheetName: list.map((item) => item.scoreSheetName).filter(Boolean).join('、'),
    optionSheetName: list.map((item) => item.optionSheetName).filter(Boolean).join('、'),
    callbackSheetName: list.map((item) => item.callbackSheetName).filter(Boolean).join('、'),
    error: !score && !callback ? '未找到评分类或投诉处理-电话回访 Sheet' : '',
  }
}

/**
 * @param {Record<string, string>[]} rows
 * @returns {NormalizedPostUseRow[]}
 */
export function normalizeSmsRows(rows) {
  /** @type {NormalizedPostUseRow[]} */
  const out = []
  for (const row of rows) {
    if (cell(row['调研结果状态']) !== '客户已反馈') continue
    const score = parseScore(row['得分（加权）'] ?? row['得分'])
    if (score == null) continue
    out.push({
      channel: 'sms',
      productName: cell(row['产品名称']),
      score,
      customerName: cell(row['集团客户名称']),
      customerCode: cell(row['集团客户编码']),
      answeredAt: cell(row['客户回复时间'] || row['问卷下发时间']),
      rawComment: cell(row['整体补充评价']),
      scene: cell(row['问卷场景']),
      raw: row,
    })
  }
  return out
}

/**
 * @param {Record<string, string>[]} rows
 * @returns {NormalizedPostUseRow[]}
 */
export function normalizeConsoleScoreRows(rows) {
  /** @type {NormalizedPostUseRow[]} */
  const out = []
  for (const row of rows) {
    const score = parseScore(row['得分'])
    if (score == null) continue
    // 官网评分类原始表头中，这三列业务上都叫“客户回答”；
    // 解析后因重名被区分为 客户回答 / 客户回答_2 / 客户回答_3。
    const feedbackReasonTexts = [
      cell(row['客户回答']),
      cell(row['客户回答_2']),
      cell(row['客户回答_3']),
    ].filter(Boolean)
    const comment = cell(row['客户回答_3']) || cell(row['客户回答_2']) || cell(row['客户回答']) || ''
    out.push({
      channel: 'console',
      productName: cell(row['产品名']),
      score,
      customerName: cell(row['集团客户名称']),
      customerCode: cell(row['集团客户编码']),
      answeredAt: cell(row['填答时间']),
      rawComment: comment,
      lowScoreReason: cell(row['不满原因']),
      feedbackReasonTexts,
      scene: cell(row['一级场景']),
      raw: row,
    })
  }
  return out
}

/**
 * @param {Record<string, string>[]} rows
 * @returns {NormalizedPostUseRow[]}
 */
export function normalizeCallbackRows(rows) {
  /** @type {NormalizedPostUseRow[]} */
  const out = []
  for (const row of rows) {
    if (!parseYesNo(row['是否回访成功'])) continue
    const score = parseScore(row[SCORE_COL_CALLBACK] ?? row['投诉整体服务评价'])
    if (score == null) continue
    out.push({
      channel: 'callback',
      productName: cell(row['具体投诉产品'] || row['投诉产品']),
      score,
      customerName: cell(row['客户名称'] || row['集团客户名称']),
      customerCode: cell(row['集团客户编码']),
      answeredAt: cell(row['回访时间'] || row['填答时间']),
      rawComment: cell(row['电话回访意见']),
      lowScoreReason: cell(row['整体服务情况不满意原因']),
      followUpTicketId: cell(row['回访工单编号']),
      originalTicketId: cell(row['原工单编号']),
      raw: row,
    })
  }
  return out
}

/**
 * @param {Record<string, string>[]} rows
 * @returns {NormalizedPostUseRow[]}
 */
export function normalizeOptionRows(rows) {
  /** @type {NormalizedPostUseRow[]} */
  const out = []
  const headers = rows[0] ? Object.keys(rows[0]) : []
  for (const row of rows) {
    out.push({
      channel: 'option',
      productName: cell(row['产品名']),
      score: NaN,
      customerName: cell(row['集团客户名称']),
      customerCode: cell(row['集团客户编码']),
      answeredAt: cell(row['填答时间']),
      rawComment: cell(row[headers[15]] || row['客户回答']),
      scene: cell(row['一级场景']),
      raw: row,
    })
  }
  return out.filter((r) => r.productName)
}

/**
 * 四字段去重：产品名+得分+客户编码+填答时间
 * @param {NormalizedPostUseRow[]} rows
 */
export function dedupeNormalizedRows(rows) {
  const seen = new Set()
  /** @type {NormalizedPostUseRow[]} */
  const out = []
  for (const row of rows) {
    if (!Number.isFinite(row.score)) {
      out.push(row)
      continue
    }
    const key = [row.productName, String(row.score), row.customerCode, row.answeredAt].join('\u0001')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(row)
  }
  return out
}

/**
 * @param {{
 *   smsRows?: Record<string, string>[]
 *   consoleRows?: Record<string, string>[]
 *   callbackRows?: Record<string, string>[]
 *   optionRows?: Record<string, string>[]
 * }} input
 */
export function buildMergedPostUseRows(input) {
  const sms = normalizeSmsRows(input.smsRows || [])
  const consoleRows = normalizeConsoleScoreRows(input.consoleRows || [])
  const callback = normalizeCallbackRows(input.callbackRows || [])
  const scored = dedupeNormalizedRows([...sms, ...consoleRows, ...callback])
  const options = normalizeOptionRows(input.optionRows || [])
  return {
    scored,
    options,
    byChannel: {
      sms,
      console: consoleRows,
      callback,
      option: options,
    },
    counts: {
      sourceRows:
        (input.smsRows || []).length +
        (input.consoleRows || []).length +
        (input.callbackRows || []).length +
        (input.optionRows || []).length,
      sms: sms.length,
      console: consoleRows.length,
      callback: callback.length,
      option: options.length,
      scoredMerged: scored.length,
      beforeDedupe: sms.length + consoleRows.length + callback.length,
      rejected:
        Math.max(0, (input.smsRows || []).length - sms.length) +
        Math.max(0, (input.consoleRows || []).length - consoleRows.length) +
        Math.max(0, (input.callbackRows || []).length - callback.length) +
        Math.max(0, (input.optionRows || []).length - options.length),
    },
  }
}
