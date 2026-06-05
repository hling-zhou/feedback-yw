import { isNegativeSentiment } from '../lib/sentiment.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

export const COMPLAINT_CAUSE_L1_COLUMN = '投诉原因 一级（终判）'
export const COMPLAINT_CAUSE_L2_COLUMN = '投诉原因 二级（终判）'
export const COMPLAINT_CAUSE_L3_COLUMN = '投诉原因 三级（终判）'
export const EMPTY_COMPLAINT_CAUSE_LABEL = '未填写'

/**
 * @param {FeedbackRecord | { dataSourceType?: string }} record
 */
export function isComplaintTicket(record) {
  return (record?.dataSourceType || 'complaint_ticket') === 'complaint_ticket'
}

/**
 * @param {Record<string, string | undefined> | null | undefined} row
 */
export function extractComplaintCauseL1FromImportRow(row) {
  const l1 =
    row?.problemTypeL1FinalCol?.trim() ||
    row?.sourceColumns?.[COMPLAINT_CAUSE_L1_COLUMN]?.trim() ||
    ''
  return l1
}

/**
 * @param {FeedbackRecord} record
 */
export function getComplaintCauseL1Final(record) {
  if (!isComplaintTicket(record)) return ''
  return record.complaintCauseL1Final?.trim() || ''
}

/**
 * @param {FeedbackRecord} record
 */
export function getComplaintCauseL1Display(record) {
  const value = getComplaintCauseL1Final(record)
  return value || EMPTY_COMPLAINT_CAUSE_LABEL
}

/**
 * 工单详情一行展示：一级 / 二级 / 三级（终判），省略空层级。
 * @param {FeedbackRecord} record
 */
export function getComplaintCauseFinalDisplay(record) {
  if (!isComplaintTicket(record)) return ''
  const parts = [
    getComplaintCauseL1Final(record),
    record.complaintCauseL2Final?.trim(),
    record.complaintCauseL3Final?.trim(),
  ].filter(Boolean)
  return parts.length ? parts.join(' / ') : EMPTY_COMPLAINT_CAUSE_LABEL
}

/**
 * @param {FeedbackRecord[]} items
 */
export function countComplaintCauseL1(items) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const fb of items) {
    if (!isComplaintTicket(fb)) continue
    const label = getComplaintCauseL1Display(fb)
    map.set(label, (map.get(label) || 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * @param {FeedbackRecord[]} items
 */
export function aggregateComplaintCauseL1Insights(items) {
  /** @type {Map<string, { label: string; count: number; negative: number; latest: string | null; ids: string[] }>} */
  const map = new Map()

  for (const fb of items) {
    if (!isComplaintTicket(fb)) continue
    const label = getComplaintCauseL1Display(fb)
    if (!map.has(label)) {
      map.set(label, { label, count: 0, negative: 0, latest: null, ids: [] })
    }
    const entry = map.get(label)
    entry.count += 1
    if (isNegativeSentiment(fb.sentiment)) entry.negative += 1
    entry.ids.push(fb.id)
    if (fb.createdAt && (!entry.latest || fb.createdAt > entry.latest)) {
      entry.latest = fb.createdAt
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count)
}

/**
 * @param {Record<string, string | undefined>} row
 * @param {string} dataSourceType
 */
export function assignComplaintCauseFieldsForImport(row, dataSourceType) {
  if (dataSourceType !== 'complaint_ticket') {
    return {
      complaintCauseL1Final: undefined,
      complaintCauseL2Final: undefined,
      complaintCauseL3Final: undefined,
    }
  }
  const l1 = extractComplaintCauseL1FromImportRow(row)
  const l2 = row.problemTypeL2FinalCol?.trim() || row.sourceColumns?.[COMPLAINT_CAUSE_L2_COLUMN]?.trim() || ''
  const l3 = row.problemTypeL3FinalCol?.trim() || row.sourceColumns?.[COMPLAINT_CAUSE_L3_COLUMN]?.trim() || ''
  return {
    complaintCauseL1Final: l1 || undefined,
    complaintCauseL2Final: l2 || undefined,
    complaintCauseL3Final: l3 || undefined,
  }
}
