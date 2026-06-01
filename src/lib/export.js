import Papa from 'papaparse'
import { normalizeSentiment, getUrgencyLevel, SENTIMENT_LABELS, URGENCY_LABELS } from './sentiment.js'
import {
  getOptimizationSourceLabel,
  getCustomerRequestSource,
  getPainPointSource,
  getOptimizationSource,
  getTicketAnalysisSourceLabel,
} from './ticketAnalysis/ticketAnalysisSources.js'
import { CUSTOMER_TIER_SOURCE_COLUMN } from '../domain/customerTier.js'

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function exportToCsv(records) {
  const rows = records.map((r) => ({
    工单号: r.ticketId || '',
    创建时间: r.createdAt || '',
    产品: r.product || '',
    产品规格: r.productSpec || '',
    资源池: r.resourcePool || '',
    [CUSTOMER_TIER_SOURCE_COLUMN]: r.customerTier || '',
    渠道: r.source || '',
    数据月份: r.importMonth || '',
    导入批次: r.importBatchName || '',
    导入文件: r.importFileName || '',
    导入工作表: r.importSheetName || '',
    导入时间: r.importedAt || '',
    请求场景: r.requestScene || '',
    通用问题类型: r.problemType || '',
    旅程一级: r.journeyL1 || '',
    旅程二级: r.journeyL2 || '',
    遇到的问题: r.painPoint || r.problemSummary || '',
    痛点来源: getTicketAnalysisSourceLabel(getPainPointSource(r)),
    解决方案: r.solutionSummary || '',
    根因: r.rootCause || '',
    优化建议: r.optimizationSuggestion || '',
    '根因（人工复核）': r.manualReviewRootCause || '',
    '优化方案（人工复核）': r.manualReviewSolution || '',
    人工复核举措: r.manualReviewAction || '',
    客户请求: r.customerRequest || '',
    客户请求来源: getTicketAnalysisSourceLabel(getCustomerRequestSource(r)),
    需求痛点: r.painPoint || r.problemSummary || '',
    优化建议来源: getOptimizationSourceLabel(getOptimizationSource(r)),
    处理意见: r.handlingText || '',
    情绪: SENTIMENT_LABELS[normalizeSentiment(r.sentiment)] || r.sentiment,
    是否加急: getUrgencyLevel(r) === 'high' ? URGENCY_LABELS.high : '',
    产品技术优化: r.optimizationProduct || '',
    服务流程改进: r.optimizationService || '',
    旅程标签: (r.themes || []).join('; '),
    备注: r.note || '',
  }))
  return Papa.unparse(rows)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} records
 */
export function downloadCsv(records, filename = 'feedback-export.csv') {
  const csv = exportToCsv(records)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

/**
 * @param {unknown} data
 * @param {string} filename
 */
/**
 * @param {import('../domain/analysisRun.js').AnalysisRunFailure[]} failures
 */
export function exportFailuresToCsv(failures) {
  const rows = failures.map((f) => ({
    行号: f.rowIndex != null ? f.rowIndex + 1 : '',
    记录ID: f.recordId || '',
    错误码: f.code,
    说明: f.message,
  }))
  return Papa.unparse(rows)
}

/**
 * @param {import('../domain/analysisRun.js').AnalysisRunFailure[]} failures
 * @param {string} [filename]
 */
export function downloadFailuresCsv(failures, filename = 'import-failures.csv') {
  if (!failures?.length) return
  const csv = exportFailuresToCsv(failures)
  const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function downloadJson(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
