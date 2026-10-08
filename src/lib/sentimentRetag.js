import { analyzeTicketSentiment } from './sentiment.js'
import { buildSentimentAnalysisText } from './sentimentAnalysisText.js'
import { getManualTagFields, preserveManualTags } from './manualTagFields.js'

/** 情绪规则只覆盖投诉、咨询工单。 */
const SENTIMENT_TICKET_TYPES = new Set(['complaint_ticket', 'consultation_ticket'])

/**
 * @param {import('./types.js').FeedbackRecord} record
 */
export function isSentimentRetagTicket(record) {
  const type = record?.dataSourceType || 'complaint_ticket'
  return SENTIMENT_TICKET_TYPES.has(type)
}

/**
 * 只重算用户情绪和加急。其他字段保持原样；人工保存的情绪/加急默认保留。
 *
 * @param {import('./types.js').FeedbackRecord} record
 * @param {{ forceOverrideManualTags?: boolean }} [options]
 * @returns {{ record: import('./types.js').FeedbackRecord, changed: boolean, keptManual: boolean, skipped: boolean }}
 */
export function retagRecordSentiment(record, options = {}) {
  if (!isSentimentRetagTicket(record)) {
    return { record, changed: false, keptManual: false, skipped: true }
  }
  const { sentiment, urgencyLevel } = analyzeTicketSentiment(buildSentimentAnalysisText(record), {
    dataSourceType: record.dataSourceType,
  })
  const next = preserveManualTags(
    record,
    { ...record, sentiment, urgencyLevel },
    { forceOverride: options.forceOverrideManualTags === true },
  )
  const manual = new Set(getManualTagFields(record))
  const keptManual =
    options.forceOverrideManualTags !== true &&
    (manual.has('sentiment') || manual.has('urgency'))
  const changed =
    next.sentiment !== record.sentiment || next.urgencyLevel !== record.urgencyLevel
  return { record: next, changed, keptManual, skipped: false }
}
