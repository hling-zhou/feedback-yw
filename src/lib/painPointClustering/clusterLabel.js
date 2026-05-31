import { DATA_SOURCE_SHORT_LABEL } from './constants.js'

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getRecordPainPoint(record) {
  return (record.painPoint || record.problemSummary || '').trim()
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 * @returns {import('../../domain/enums.js').DataSourceType}
 */
export function getRecordDataSourceType(record) {
  return record.dataSourceType || 'complaint_ticket'
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function majorityProblemType(records) {
  const map = new Map()
  for (const r of records) {
    const pt = r.problemType?.trim() || '其他'
    map.set(pt, (map.get(pt) || 0) + 1)
  }
  let best = '其他'
  let bestCount = 0
  for (const [pt, count] of map) {
    if (count > bestCount) {
      best = pt
      bestCount = count
    }
  }
  return best
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function pickRepresentativePainPoint(records) {
  const map = new Map()
  for (const r of records) {
    const pain = getRecordPainPoint(r)
    if (!pain) continue
    map.set(pain, (map.get(pain) || 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [text, count] of map) {
    if (count > bestCount || (count === bestCount && text.length > best.length)) {
      best = text
      bestCount = count
    }
  }
  return best
}

/**
 * @param {Object} params
 * @param {string} params.product
 * @param {import('../../domain/enums.js').DataSourceType} params.dataSourceType
 * @param {string} params.journeyL1
 * @param {string} params.representativePainPoint
 */
export function buildPrimaryClusterLabel({
  product,
  dataSourceType,
  journeyL1,
  representativePainPoint,
}) {
  const source = DATA_SOURCE_SHORT_LABEL[dataSourceType] || dataSourceType
  const pain = (representativePainPoint || '').slice(0, 40)
  return `${product}-${source}-${journeyL1}-${pain}`
}

/**
 * @param {string} label
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function buildFinalClusterLabel(label, records) {
  if (label?.trim()) return label.trim()
  return pickRepresentativePainPoint(records).slice(0, 60) || '未命名痛点群组'
}
