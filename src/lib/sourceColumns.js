/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

import { CUSTOMER_TIER_SOURCE_COLUMN } from '../domain/customerTier.js'

/** 导出 Excel 时使用的原始工单列名（与工单模板一致） */
export const TICKET_SOURCE_COLUMN_LABELS = [
  '处理意见',
  '投诉原因 一级（终判）',
  '投诉原因 二级（终判）',
  '投诉原因 三级（终判）',
  '根因（必填）',
  '解决方案（必填）',
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
  put('根因（必填）', row.rootCauseCol)
  put('解决方案（必填）', row.responseText)
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
  if (label === '根因（必填）') return record.rootCause || ''
  if (label === '解决方案（必填）') return record.responseText || record.solutionSummary || ''
  if (label === '投诉原因 一级（终判）') return record.problemType || ''
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
 * @param {FeedbackRecord[]} records
 */
export function recordsMissingSourceColumns(records) {
  return records.filter(
    (r) =>
      !r.sourceColumns ||
      !TICKET_SOURCE_COLUMN_LABELS.some((label) => r.sourceColumns?.[label]),
  )
}

/**
 * @param {FeedbackRecord[]} records
 */
/**
 * 是否存在缺少原始列快照、或快照中缺关键列的记录（需提示重新导入）
 * @param {FeedbackRecord[]} records
 */
export function hasIncompleteSourceColumns(records) {
  return records.some((r) => {
    if (!r.sourceColumns) return true
    return TICKET_SOURCE_COLUMN_LABELS.some((label) => !r.sourceColumns?.[label]?.trim())
  })
}
