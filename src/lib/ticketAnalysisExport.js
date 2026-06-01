import { Modal, message } from 'antd'
import * as XLSX from 'xlsx'
import { normalizeSentiment, getUrgencyLevel, SENTIMENT_LABELS, URGENCY_LABELS } from './sentiment.js'
import {
  getOptimizationSourceLabel,
  getCustomerRequestSource,
  getPainPointSource,
  getOptimizationSource,
  getTicketAnalysisSourceLabel,
} from './ticketAnalysis/ticketAnalysisSources.js'
import { getComplaintCauseL1Display, isComplaintTicket } from '../domain/complaintCause.js'
import { getExportColumns, readFieldValue } from '../domain/fieldRegistry.js'
import { getEffectiveRootCauseReview } from '../domain/rootCauseReview.js'
import {
  extractAcceptanceTextFromFields,
  extractHandlingTextFromFields,
} from './taggingText.js'
import {
  TICKET_SOURCE_COLUMN_LABELS,
  getSourceColumnValue,
  hasIncompleteSourceColumns,
  recordsMissingSourceColumns,
} from './sourceColumns.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/** 当前分析结果导出列版本（Field Registry v2） */
export const EXPORT_ANALYSIS_VERSION = 2

/**
 * v2 导出表头（Field Registry 列序）。
 * @param {{ dataSourceType?: import('../domain/enums.js').DataSourceType }} [options]
 * @returns {string[]}
 */
export function getExportV2Headers(options = {}) {
  return getExportColumns(options).map((field) => field.displayName)
}

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
    default:
      return readFieldValue(record, field)
  }
}

/**
 * 分析结果导出 v2：列定义与顺序唯一来自 Field Registry。
 *
 * @param {FeedbackRecord} record
 * @returns {Record<string, string>}
 */
export function recordToExportRowV2(record) {
  /** @type {Record<string, string>} */
  const row = {}
  const columns = getExportColumns({ dataSourceType: record.dataSourceType })
  for (const field of columns) {
    row[field.displayName] = exportRegistryFieldValue(record, field)
  }
  return row
}

/**
 * @deprecated 旧版导出列；保留供迁移对照与 `exportAnalysisV2: false`
 * @param {FeedbackRecord} r
 */
export function recordToExportRowLegacy(r) {
  const sentimentKey = normalizeSentiment(r.sentiment)
  return {
    工单号: r.ticketId || '',
    时间: r.createdAt || '',
    请求场景: r.requestScene || '',
    问题类型: r.problemType || '',
    '投诉原因（终判）': isComplaintTicket(r) ? getComplaintCauseL1Display(r) : '',
    用户旅程一级: r.journeyL1 || '',
    用户旅程二级: r.journeyL2 || '',
    用户情绪: SENTIMENT_LABELS[sentimentKey] || r.sentiment || '',
    是否加急: getUrgencyLevel(r) === 'high' ? URGENCY_LABELS.high : '',
    客户请求内容: r.customerRequest || '',
    客户请求来源: getTicketAnalysisSourceLabel(getCustomerRequestSource(r)),
    客户原话: r.customerQuote || '',
    需求痛点: r.painPoint || r.problemSummary || '',
    痛点来源: getTicketAnalysisSourceLabel(getPainPointSource(r)),
    产品技术优化: r.optimizationProduct || '',
    服务流程改进: r.optimizationService || '',
    优化建议来源: getOptimizationSourceLabel(getOptimizationSource(r)),
    问题摘要: r.problemSummary || '',
    根因: r.rootCause || '',
    优化建议: r.optimizationSuggestion || '',
    '根因（人工复核）': r.manualReviewRootCause || '',
    '优化方案（人工复核）': r.manualReviewSolution || '',
    人工复核举措: r.manualReviewAction || '',
    ...Object.fromEntries(
      TICKET_SOURCE_COLUMN_LABELS.map((label) => [label, getSourceColumnValue(r, label)]),
    ),
  }
}

/**
 * @param {string} importMonth YYYY-MM
 */
export function formatImportMonthSheetName(importMonth) {
  const m = String(importMonth || '').match(/^(\d{4})-(\d{2})$/)
  if (!m) return '未知月份'
  return `${m[1]}年${Number(m[2])}月`.slice(0, 31)
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {Map<string, FeedbackRecord[]>}
 */
export function groupRecordsByImportMonth(records) {
  /** @type {Map<string, FeedbackRecord[]>} */
  const groups = new Map()
  for (const r of records) {
    const month =
      r.importMonth && /^\d{4}-\d{2}$/.test(r.importMonth)
        ? r.importMonth
        : 'unknown'
    const list = groups.get(month) || []
    list.push(r)
    groups.set(month, list)
  }
  return groups
}

/**
 * @param {FeedbackRecord[]} records
 * @param {string} [filename]
 * @param {{ exportAnalysisV2?: boolean }} [options]
 */
export function downloadTicketAnalysisExcel(records, filename, options = {}) {
  const useV2 = options.exportAnalysisV2 !== false
  const toRow = useV2 ? recordToExportRowV2 : recordToExportRowLegacy
  const groups = groupRecordsByImportMonth(records)
  const months = [...groups.keys()].sort((a, b) => {
    if (a === 'unknown') return 1
    if (b === 'unknown') return -1
    return b.localeCompare(a)
  })

  const wb = XLSX.utils.book_new()
  for (const month of months) {
    const items = groups.get(month) || []
    const rows = items.map(toRow)
    const ws = XLSX.utils.json_to_sheet(
      rows.length ? rows : [{ 提示: '该月无数据' }],
    )
    XLSX.utils.book_append_sheet(wb, ws, formatImportMonthSheetName(month === 'unknown' ? '' : month))
  }

  if (months.length === 0) {
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
 * 导出当前筛选范围工单（含原始列不完整确认）
 * @param {FeedbackRecord[]} records
 * @param {{ filePrefix?: string; periodLabel?: string; totalInDb?: number; totalScopeLabel?: string; exportAnalysisV2?: boolean }} [options]
 */
export function exportTicketAnalysisWithConfirm(records, options = {}) {
  const filePrefix = options.filePrefix || '洞察分析'
  const periodLabel = options.periodLabel || '周期'
  const useV2 = options.exportAnalysisV2 !== false

  if (records.length === 0) {
    message.warning('当前筛选范围内无数据可导出')
    return
  }

  const versionSuffix = useV2 ? '' : '-legacy'
  const filename = `${filePrefix}-${periodLabel}${versionSuffix}-${new Date().toISOString().slice(0, 10)}.xlsx`
  const runExport = () =>
    downloadTicketAnalysisExcel(records, filename, { exportAnalysisV2: useV2 })

  const scopeLabel = options.totalScopeLabel || '库内'
  const totalHint =
    options.totalInDb != null && options.totalInDb !== records.length
      ? `（${scopeLabel}共 ${options.totalInDb} 条）`
      : ''

  if (!hasIncompleteSourceColumns(records)) {
    runExport()
    message.success(
      useV2
        ? `已导出 ${records.length} 条（分析结果 v${EXPORT_ANALYSIS_VERSION}，16 列）${totalHint}`
        : `已导出 ${records.length} 条（旧版列）${totalHint}`,
    )
    return
  }

  const noSnap = recordsMissingSourceColumns(records).length
  Modal.confirm({
    title: '原始工单列不完整',
    content: `当前范围内有 ${noSnap || records.length} 条工单缺少原始列快照，请重新导入以补全原始列（处理意见、投诉原因终判、根因、解决方案等）。是否仍继续导出？`,
    okText: '继续导出',
    cancelText: '取消',
    onOk: () => {
      runExport()
      message.success(`已导出 ${records.length} 条${totalHint}（部分原始列为空）`)
    },
  })
}

export { hasIncompleteSourceColumns, recordsMissingSourceColumns }
