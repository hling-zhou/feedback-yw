/**
 * v2 分层记录模型（JSDoc）
 * 工单类字段与 v1 FeedbackRecord 兼容，便于迁移。
 */

/** @typedef {import('../lib/sentiment.js').Sentiment} Sentiment */
/** @typedef {import('../lib/types.js').FeedbackStatus} FeedbackStatus */

/**
 * @typedef {Object} VersionedMeta
 * @property {string} schemaVersion
 * @property {string} [pipelineVersion]
 * @property {string} [tagLibraryVersion]
 */

/**
 * @typedef {Object} BaseRecord
 * @property {string} id
 * @property {import('./enums.js').DataSourceType} dataSourceType
 * @property {string} insightPeriodId
 * @property {string} tenantId
 * @property {import('./enums.js').RecordStatus} recordStatus
 * @property {string} [importMonth]
 * @property {string} [importBatchId]
 * @property {string} [importBatchName]
 * @property {string} [importFileName]
 * @property {string} [importSheetName]
 * @property {string} importedAt
 * @property {string} [createdAt]
 * @property {string} [product]
 * @property {string} [productKey]
 * @property {string} schemaVersion
 * @property {string} [quoteExtractionVersion]
 * @property {boolean} [outOfPeriodWarning]
 */

/**
 * 投诉 / 咨询工单（复用 v1 打标字段）
 * @typedef {BaseRecord & {
 *   source?: string
 *   rawText: string
 *   customerQuote: string
 *   responseText?: string
 *   handlingText?: string
 *   productSpec?: string
 *   version?: string
 *   ticketId?: string
 *   resourcePool?: string
 *   customerTier?: import('./customerTier.js').CustomerTier
 *   requestScene: string
 *   problemType: string
 *   journeyL1: string
 *   journeyL2: string
 *   problemSummary: string
 *   solutionSummary: string
 *   rootCause: string
 *   optimizationSuggestion: string
 *   manualReviewRootCause?: string
 *   manualReviewSolution?: string
 *   manualReviewAction?: string
 *   sourceColumns?: Record<string, string>
 *   complaintCauseL1Final?: string
 *   complaintCauseL2Final?: string
 *   complaintCauseL3Final?: string
 *   complaintCauseL1Review?: string
 *   complaintCauseL2Review?: string
 *   complaintCauseL3Review?: string
 *   complaintCauseReviewReason?: string
 *   sentiment: Sentiment
 *   urgencyLevel?: import('../lib/sentiment.js').UrgencyLevel
 *   themes: string[]
 *   status: FeedbackStatus
 *   note?: string
 *   listeningReviewed?: boolean
 *   followUpSatisfaction?: import('./followUpSatisfaction.js').FollowUpSatisfaction
 * }} TicketRecord
 */

/**
 * @typedef {BaseRecord & {
 *   ratingScore?: number
 *   ratingDimension?: string
 *   commentText?: string
 * }} PostUseRatingRecord
 */

/**
 * @typedef {BaseRecord & {
 *   surveyId?: string
 *   questionId?: string
 *   responseValue?: string
 *   openText?: string
 * }} SurveyRecord
 */

/**
 * @typedef {BaseRecord & {
 *   title?: string
 *   body?: string
 * }} GenericRecord
 */

/** @typedef {TicketRecord | PostUseRatingRecord | SurveyRecord | GenericRecord} InsightRecord */

/**
 * @param {import('./enums.js').DataSourceType} dataSourceType
 * @returns {'ticket' | 'post_use_rating' | 'survey' | 'generic'}
 */
export function recordKind(dataSourceType) {
  if (dataSourceType === 'complaint_ticket' || dataSourceType === 'consultation_ticket') {
    return 'ticket'
  }
  if (dataSourceType === 'post_use_rating') return 'post_use_rating'
  if (dataSourceType === 'user_survey') return 'survey'
  return 'generic'
}

/**
 * @param {InsightRecord} record
 * @returns {record is TicketRecord}
 */
export function isTicketRecord(record) {
  return recordKind(record.dataSourceType) === 'ticket'
}

/**
 * 业务去重键（NFR-R-031）
 * @param {Pick<BaseRecord, 'dataSourceType' | 'importMonth' | 'id'> & { ticketId?: string; ratingId?: string; respondentId?: string; questionId?: string }} record
 */
export function buildDedupeKey(record) {
  const month = record.importMonth || 'unknown'
  if (record.dataSourceType === 'complaint_ticket' || record.dataSourceType === 'consultation_ticket') {
    const ticketId = typeof record.ticketId === 'string' ? record.ticketId.trim() : ''
    if (ticketId) {
      return `${record.dataSourceType}::${month}::ticket::${ticketId}`
    }
    if (record.id) {
      return `${record.dataSourceType}::${month}::id::${record.id}`
    }
    return ''
  }
  if (record.dataSourceType === 'user_survey') {
    return `${record.dataSourceType}::${month}::${record.respondentId || ''}::${record.questionId || ''}`
  }
  if (record.dataSourceType === 'post_use_rating' && 'ratingId' in record) {
    return `${record.dataSourceType}::${month}::${record.ratingId || ''}`
  }
  return `${record.dataSourceType}::${month}::${record.id || ''}`
}

/**
 * 工单全局去重键：仅"数据源类型+工单号"，不限导入月份。
 * 仅工单类数据源返回非空；空工单号或其他数据源返回 ''。
 * @param {{ dataSourceType?: string; ticketId?: string }} record
 */
export function buildGlobalTicketDedupeKey({ dataSourceType, ticketId }) {
  const type = dataSourceType || 'complaint_ticket'
  if (type !== 'complaint_ticket' && type !== 'consultation_ticket') return ''
  const id = typeof ticketId === 'string' ? ticketId.trim() : ''
  if (!id) return ''
  return `${type}::ticket::${id}`
}
