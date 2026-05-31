/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

/** 单条工单分析流水线版本（变更后需使旅程举措缓存失效） */
export const TICKET_ANALYSIS_PIPELINE_VERSION = 'ta-3'

/**
 * @param {FeedbackRecord | Partial<FeedbackRecord>} record
 */
export function ticketAnalysisFieldsDigest(record) {
  const pain = (record.painPoint || record.problemSummary || '').trim().slice(0, 48)
  const manual = record.manualReviewOptimization?.trim().slice(0, 48) || ''
  const product = record.optimizationProduct?.trim().slice(0, 48) || ''
  const service = record.optimizationService?.trim().slice(0, 48) || ''
  return `${pain}|${manual}|${product}|${service}`
}

/**
 * 旅程举措缓存指纹：工单集合 + 单条分析字段（痛点/优化建议）+ 流水线版本
 *
 * @param {FeedbackRecord[]} records
 */
export function computeJourneyMeasuresFingerprintFromRecords(records) {
  const sorted = [...(records || [])].sort((a, b) => String(a.id).localeCompare(String(b.id)))
  if (!sorted.length) {
    return `${TICKET_ANALYSIS_PIPELINE_VERSION}:0`
  }
  const digest = sorted
    .slice(0, 60)
    .map((r) => `${r.id}:${ticketAnalysisFieldsDigest(r)}`)
    .join('\0')
  return `${TICKET_ANALYSIS_PIPELINE_VERSION}:${sorted.length}:${digest.slice(0, 480)}`
}

/**
 * @deprecated 使用 computeJourneyMeasuresFingerprintFromRecords
 * @param {string[]} itemIds
 */
export function computeJourneyMeasuresFingerprint(itemIds) {
  const sorted = [...(itemIds || [])].sort()
  if (!sorted.length) return `${TICKET_ANALYSIS_PIPELINE_VERSION}:0`
  const head = sorted.slice(0, 40).join('\0')
  return `${TICKET_ANALYSIS_PIPELINE_VERSION}:ids:${sorted.length}:${head.slice(0, 200)}`
}
