/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

import {
  COMPLAINT_CAUSE_L1_COLUMN,
  COMPLAINT_CAUSE_L2_COLUMN,
  COMPLAINT_CAUSE_L3_COLUMN,
  isComplaintTicket,
} from '../domain/complaintCause.js'
import { CUSTOMER_TIER_SOURCE_COLUMN } from '../domain/customerTier.js'

/** 导出 Excel 时使用的原始工单列名（与工单模板一致） */
export const TICKET_SOURCE_COLUMN_LABELS = [
  '处理意见',
  '投诉原因 一级（终判）',
  '投诉原因 二级（终判）',
  '投诉原因 三级（终判）',
  '问题原因',
  '优化举措/建议',
]

/**
 * 从导入映射行构建原始列快照（按中文列名存储，供导出回显）
 * @param {Record<string, string | undefined>} row
 * @returns {Record<string, string> | undefined}
 */
export function buildSourceColumns(row) {
  if (!row) return undefined
  /** @type {Record<string, string>} */
  const cols = {}

  const put = (label, value) => {
    const v = value?.trim()
    if (v) cols[label] = v
  }

  put('处理意见', row.handlingText)
  put('投诉原因 一级（终判）', row.problemTypeL1FinalCol)
  put('投诉原因 二级（终判）', row.problemTypeL2FinalCol)
  put('投诉原因 三级（终判）', row.problemTypeL3FinalCol)
  put('问题原因', row.rootCauseCol)
  put('优化举措/建议', row.responseText)
  put(CUSTOMER_TIER_SOURCE_COLUMN, row.customerTierCol || row.customerTier)

  return Object.keys(cols).length > 0 ? cols : undefined
}

/**
 * @param {FeedbackRecord} record
 * @param {string} label
 */
export function getSourceColumnValue(record, label) {
  const snap = record?.sourceColumns
  if (snap?.[label]) return snap[label]
  if (label === '处理意见') return record.handlingText || ''
  if (label === '受理内容') {
    return snap?.['受理内容'] || record.rawText || ''
  }
  if (label === '问题原因' || label === '根因（必填）' || label === '根因') {
    return record.rootCause || snap?.['问题原因'] || snap?.['根因（必填）'] || ''
  }
  if (
    label === '优化举措/建议' ||
    label === '解决方案（必填）' ||
    label === '解决方案'
  ) {
    return (
      record.responseText ||
      record.solutionSummary ||
      snap?.['优化举措/建议'] ||
      snap?.['解决方案（必填）'] ||
      ''
    )
  }
  if (label === '投诉原因 一级（终判）') {
    if (!isComplaintTicket(record)) return ''
    return record.complaintCauseL1Final?.trim() || snap?.[COMPLAINT_CAUSE_L1_COLUMN]?.trim() || ''
  }
  if (label === '投诉原因 二级（终判）') {
    if (!isComplaintTicket(record)) return ''
    return record.complaintCauseL2Final?.trim() || snap?.[COMPLAINT_CAUSE_L2_COLUMN]?.trim() || ''
  }
  if (label === '投诉原因 三级（终判）') {
    if (!isComplaintTicket(record)) return ''
    return record.complaintCauseL3Final?.trim() || snap?.[COMPLAINT_CAUSE_L3_COLUMN]?.trim() || ''
  }
  if (label === CUSTOMER_TIER_SOURCE_COLUMN || label === '客户等级') {
    return (
      record.customerTier ||
      snap?.[CUSTOMER_TIER_SOURCE_COLUMN] ||
      snap?.['客户等级'] ||
      ''
    )
  }
  return ''
}

/**
 * @param {FeedbackRecord} record
 * @returns {string[]}
 */
function requiredSourceColumnLabels(record) {
  const complaintOnly = [
    '投诉原因 一级（终判）',
    '投诉原因 二级（终判）',
    '投诉原因 三级（终判）',
  ]
  if (isComplaintTicket(record)) return TICKET_SOURCE_COLUMN_LABELS
  return TICKET_SOURCE_COLUMN_LABELS.filter((label) => !complaintOnly.includes(label))
}

/**
 * @param {FeedbackRecord[]} records
 */
export function recordsMissingSourceColumns(records) {
  return records.filter((r) => {
    if (!r.sourceColumns) return true
    const required = requiredSourceColumnLabels(r)
    return !required.some((label) => r.sourceColumns?.[label]?.trim())
  })
}

/**
 * 是否存在缺少原始列快照、或快照中缺关键列的记录（需提示重新导入）
 * @param {FeedbackRecord[]} records
 */
export function hasIncompleteSourceColumns(records) {
  return records.some((r) => {
    if (!r.sourceColumns) return true
    return requiredSourceColumnLabels(r).some((label) => !r.sourceColumns?.[label]?.trim())
  })
}
