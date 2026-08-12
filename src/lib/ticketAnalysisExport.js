import { message } from 'antd'
import * as XLSX from 'xlsx'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import { normalizeSentiment, getUrgencyLevel, SENTIMENT_LABELS, URGENCY_LABELS } from './sentiment.js'
import { getExportColumns, readFieldValue } from '../domain/fieldRegistry.js'
import { getEffectiveRootCauseReview } from '../domain/rootCauseReview.js'
import { recordSourceType } from '../snapshots/recordScope.js'
import {
  extractAcceptanceTextFromFields,
  extractHandlingTextFromFields,
} from './taggingText.js'
import {
  getSourceColumnValue,
  hasIncompleteSourceColumns,
  recordsMissingSourceColumns,
} from './sourceColumns.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/** 当前分析结果导出列版本（Field Registry v3，含回访满意度） */
export const EXPORT_ANALYSIS_VERSION = 3

/**
 * v3 导出表头（Field Registry 列序）。
 * @param {{ dataSourceType?: import('../domain/enums.js').DataSourceType }} [options]
 * @returns {string[]}
 */
export function getExportV3Headers(options = {}) {
  return getExportColumns(options).map((field) => field.displayName)
}

/** @deprecated 使用 getExportV3Headers */
export const getExportV2Headers = getExportV3Headers

/**
 * @param {FeedbackRecord} record
 * @param {import('../domain/fieldRegistry.js').FieldDefinition} field
 */
function exportRegistryFieldValue(record, field) {
  const taggingFields = {
    handlingText: record.handlingText,
    rawText: record.rawText,
    sourceColumns: record.sourceColumns,
  }

  switch (field.fieldKey) {
    case 'ticketId':
      return record.ticketId || ''
    case 'product':
      return record.product || ''
    case 'customerRequest':
      return record.customerRequest || ''
    case 'painPoint':
      return readFieldValue(record, field)
    case 'requestScene':
      return record.requestScene || ''
    case 'problemType':
      return record.problemType || ''
    case 'journeyL1':
      return record.journeyL1 || ''
    case 'journeyL2':
      return record.journeyL2 || ''
    case 'sentiment': {
      const sentimentKey = normalizeSentiment(record.sentiment)
      return SENTIMENT_LABELS[sentimentKey] || record.sentiment || ''
    }
    case 'urgency':
      return getUrgencyLevel(record) === 'high' ? URGENCY_LABELS.high : ''
    case 'optimizationProduct':
      return record.optimizationProduct || ''
    case 'optimizationService':
      return record.optimizationService || ''
    case 'productGroupOptimization':
      return record.productGroupOptimization || ''
    case 'designerOptimization':
      return record.designerOptimization || ''
    case 'establishedAction':
      return readFieldValue(record, field)
    case 'actionSchedule':
      return record.actionSchedule || ''
    case 'acceptanceContent': {
      const fromSnapshot = getSourceColumnValue(record, '受理内容')
      if (fromSnapshot?.trim()) return fromSnapshot
      return extractAcceptanceTextFromFields(taggingFields)
    }
    case 'handlingOpinion':
      return extractHandlingTextFromFields(taggingFields)
    case 'rootCauseReview':
      return getEffectiveRootCauseReview(record)
    case 'customerTypeName':
      return getSourceColumnValue(record, '客户类型名称')
    case 'groupName':
      return getSourceColumnValue(record, '集团名称')
    case 'groupCustomerCode':
      return getSourceColumnValue(record, '集团客户编码')
    case 'groupProvince':
      return getSourceColumnValue(record, '集团所属省份')
    case 'groupCity':
      return getSourceColumnValue(record, '集团所属地市')
    case 'loginAccountName':
      return getSourceColumnValue(record, '登录账号名称')
    case 'customerTierExport':
      return getSourceColumnValue(record, '移动云客户服务等级') || record.customerTier || ''
    case 'acceptChannel':
      return getSourceColumnValue(record, '受理渠道') || record.source || ''
    default:
      return readFieldValue(record, field)
  }
}

/**
 * 分析结果导出 v3：列定义与顺序唯一来自 Field Registry。
 *
 * @param {FeedbackRecord} record
 * @returns {Record<string, string>}
 */
export function recordToExportRowV3(record) {
  /** @type {Record<string, string>} */
  const row = {}
  const columns = getExportColumns({ dataSourceType: record.dataSourceType })
  for (const field of columns) {
    row[field.displayName] = exportRegistryFieldValue(record, field)
  }
  return row
}

/** @deprecated 使用 recordToExportRowV3 */
export const recordToExportRowV2 = recordToExportRowV3

/**
 * @param {string} importMonth YYYY-MM
 */
export function formatImportMonthSheetName(importMonth) {
  const m = String(importMonth || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return '未知月份'
  return `${m[1]}年${Number(m[2])}月`.slice(0, 31)
}

/**
 * @param {FeedbackRecord} record
 * @returns {string} YYYY-MM or `unknown`
 */
export function normalizeExportGroupMonth(record) {
  return record.importMonth && /^\d{4}-\d{2}$/.test(record.importMonth)
    ? record.importMonth
    : 'unknown'
}

/**
 * @param {import('../domain/enums.js').DataSourceType | string} dataSourceType
 * @param {string} importMonth YYYY-MM or empty
 */
export function formatExportSourceMonthSheetName(dataSourceType, importMonth) {
  const sourceLabel = DATA_SOURCE_LABELS[dataSourceType] || dataSourceType || '未知来源'
  const monthLabel =
    importMonth && /^\d{4}-\d{2}$/.test(importMonth)
      ? formatImportMonthSheetName(importMonth)
      : '未知月份'
  return `${sourceLabel}-${monthLabel}`.slice(0, 31)
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {Map<string, FeedbackRecord[]>} key = `${dataSourceType}\0${monthKey}`
 */
export function groupRecordsBySourceAndMonth(records) {
  /** @type {Map<string, FeedbackRecord[]>} */
  const groups = new Map()
  for (const record of records) {
    const source = recordSourceType(record)
    const month = normalizeExportGroupMonth(record)
    const key = `${source}\0${month}`
    const list = groups.get(key) || []
    list.push(record)
    groups.set(key, list)
  }
  return groups
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {Map<string, FeedbackRecord[]>}
 * @deprecated 使用 groupRecordsBySourceAndMonth
 */
export function groupRecordsByImportMonth(records) {
  /** @type {Map<string, FeedbackRecord[]>} */
  const groups = new Map()
  for (const r of records) {
    const month = normalizeExportGroupMonth(r)
    const list = groups.get(month) || []
    list.push(r)
    groups.set(month, list)
  }
  return groups
}

/**
 * @param {string} groupKey
 */
function parseSourceMonthGroupKey(groupKey) {
  const sep = groupKey.indexOf('\0')
  if (sep === -1) return { source: groupKey, month: 'unknown' }
  return {
    source: groupKey.slice(0, sep),
    month: groupKey.slice(sep + 1) || 'unknown',
  }
}

/**
 * @param {string} a
 * @param {string} b
 */
function compareSourceMonthGroupKeys(a, b) {
  const ka = parseSourceMonthGroupKey(a)
  const kb = parseSourceMonthGroupKey(b)
  const sa = DATA_SOURCE_LABELS[ka.source] || ka.source
  const sb = DATA_SOURCE_LABELS[kb.source] || kb.source
  const sourceCmp = sa.localeCompare(sb, 'zh-CN')
  if (sourceCmp !== 0) return sourceCmp
  if (ka.month === 'unknown') return 1
  if (kb.month === 'unknown') return -1
  return kb.month.localeCompare(ka.month)
}

/**
 * @param {FeedbackRecord[]} records
 * @param {string} [filename]
 */
export function downloadTicketAnalysisExcel(records, filename) {
  const groups = groupRecordsBySourceAndMonth(records)
  const keys = [...groups.keys()].sort(compareSourceMonthGroupKeys)

  const wb = XLSX.utils.book_new()
  for (const key of keys) {
    const { source, month } = parseSourceMonthGroupKey(key)
    const items = groups.get(key) || []
    const rows = items.map(recordToExportRowV3)
    const ws = XLSX.utils.json_to_sheet(
      rows.length ? rows : [{ 提示: '该 sheet 无数据' }],
    )
    XLSX.utils.book_append_sheet(
      wb,
      ws,
      formatExportSourceMonthSheetName(source, month === 'unknown' ? '' : month),
    )
  }

  if (keys.length === 0) {
    const ws = XLSX.utils.json_to_sheet([{ 提示: '无数据' }])
    XLSX.utils.book_append_sheet(wb, ws, '无数据')
  }

  const buf = XLSX.write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  const name =
    filename ||
    `洞察分析导出-${new Date().toISOString().slice(0, 10)}.xlsx`
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.endsWith('.xlsx') ? name : `${name}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * 导出当前筛选范围工单的分析结果 v3。
 * @param {FeedbackRecord[]} records
 * @param {{ filePrefix?: string; periodLabel?: string; totalInDb?: number; totalScopeLabel?: string }} [options]
 */
export function exportTicketAnalysisWithConfirm(records, options = {}) {
  const filePrefix = options.filePrefix || '洞察分析'
  const periodLabel = options.periodLabel || '周期'

  if (records.length === 0) {
    message.warning('当前筛选范围内无数据可导出')
    return
  }

  const filename = `${filePrefix}-${periodLabel}-${new Date().toISOString().slice(0, 10)}.xlsx`
  downloadTicketAnalysisExcel(records, filename)

  const scopeLabel = options.totalScopeLabel || '库内'
  const totalHint =
    options.totalInDb != null && options.totalInDb !== records.length
      ? `（${scopeLabel}共 ${options.totalInDb} 条）`
      : ''

  message.success(
    `已导出 ${records.length} 条（分析结果 v${EXPORT_ANALYSIS_VERSION}，${getExportV3Headers().length} 列）${totalHint}`,
  )
}

export { hasIncompleteSourceColumns, recordsMissingSourceColumns }
