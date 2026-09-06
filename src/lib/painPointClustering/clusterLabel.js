import { DATA_SOURCE_SHORT_LABEL } from './constants.js'
import { getClusteringPainText } from './clusteringCorpus.js'
import { getClusteringCauseText, pickRepresentativeCause } from './clusteringCause.js'

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getRecordPainPoint(record) {
  return getClusteringPainText(record)
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
 * v2.4 类名：优先多数「问题原因」短语；无自由文本时用多数三级原因；
 * 都没有时用 problemType + 旅程 L2；禁止停在「云能问题」「产品原因」。
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {{ problemType?: string; journeyL2?: string }} [scope]
 */
export function pickRepresentativeCauseLabel(records, scope = {}) {
  // 1. 多数问题原因短语（自由文本，已剥组织归责）
  const cause = pickRepresentativeCause(records)
  if (cause) return cause
  // 2. 无可用问题原因：回退 problemType + 旅程 L2，不用最长痛点句
  const pt = scope.problemType?.trim() || majorityProblemType(records)
  const l2 = scope.journeyL2?.trim() || topJourneyL2(records)
  if (l2 && pt && pt !== '其他') return `${pt}·${l2}`
  if (l2) return l2
  if (pt && pt !== '其他') return pt
  return ''
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
function topJourneyL2(records) {
  const map = new Map()
  for (const r of records) {
    const l2 = r.journeyL2?.trim()
    if (!l2) continue
    map.set(l2, (map.get(l2) || 0) + 1)
  }
  let best = ''
  let bestCount = 0
  for (const [text, count] of map) {
    if (count > bestCount) {
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
  // v2.4：无 label 时优先多数问题原因，再回退痛点
  const causeLabel = pickRepresentativeCauseLabel(records)
  if (causeLabel) return causeLabel.slice(0, 60)
  return pickRepresentativePainPoint(records).slice(0, 60) || '未命名问题群组'
}
