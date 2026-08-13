import { randomId } from '../randomId.js'
import { SCHEMA_VERSION } from '../../domain/constants.js'
import { buildPostUseEvidence } from './evidence.js'

/** @typedef {import('./parseChannels.js').NormalizedPostUseRow} NormalizedPostUseRow */

/**
 * @param {NormalizedPostUseRow} row
 * @param {{
 *   importMonth: string
 *   importBatchId: string
 *   importBatchName?: string
 *   importFileName?: string
 *   tenantId?: string
 *   importedAt?: string
 * }} meta
 */
export function buildPostUseRatingRecord(row, meta) {
  const sourceSubType =
    row.channel === 'sms'
      ? 'sms_survey'
      : row.channel === 'console'
        ? 'web_survey'
        : row.channel === 'callback'
          ? 'satisfaction_callback'
          : 'web_option'

  const id = randomId()
  const evidence = buildPostUseEvidence(row, {
    recordId: id,
    importMonth: meta.importMonth,
    importBatchId: meta.importBatchId,
  })
  return {
    id,
    schemaVersion: SCHEMA_VERSION,
    tenantId: meta.tenantId || 'default',
    dataSourceType: /** @type {const} */ ('post_use_rating'),
    recordStatus: /** @type {const} */ ('raw'),
    importedAt: meta.importedAt || new Date().toISOString(),
    importBatchId: meta.importBatchId,
    importBatchName: meta.importBatchName,
    importFileName: meta.importFileName,
    importMonth: meta.importMonth,
    product: row.productName,
    productName: row.productName,
    ratingScore: Number.isFinite(row.score) ? row.score : undefined,
    commentText: row.rawComment || '',
    rawText: row.rawComment || row.lowScoreReason || '',
    customerQuote: row.rawComment || '',
    createdAt: row.answeredAt || undefined,
    sourceSubType,
    channel: row.channel,
    customerName: row.customerName,
    customerCode: row.customerCode,
    lowScoreReason: row.lowScoreReason,
    feedbackReasonTexts: Array.isArray(row.feedbackReasonTexts) ? row.feedbackReasonTexts.filter(Boolean) : undefined,
    feedbackReasonPrimary: Array.isArray(row.feedbackReasonTexts) ? row.feedbackReasonTexts[0] || '' : '',
    feedbackReasonSecondary: Array.isArray(row.feedbackReasonTexts) ? row.feedbackReasonTexts[1] || '' : '',
    feedbackReasonTertiary: Array.isArray(row.feedbackReasonTexts) ? row.feedbackReasonTexts[2] || '' : '',
    scene: row.scene,
    originalScene: row.scene || '未提供',
    surveyName: row.surveyName || '',
    touchpointPageName: row.touchpointPageName || '',
    evidence,
    followUpTicketId: row.followUpTicketId,
    originalTicketId: row.originalTicketId,
    ratingId: id,
  }
}

/**
 * @param {NormalizedPostUseRow[]} scoredRows
 * @param {Parameters<typeof buildPostUseRatingRecord>[1]} meta
 */
export function buildPostUseRatingRecords(scoredRows, meta) {
  return scoredRows
    .filter((r) => r.channel === 'option' || Number.isFinite(r.score))
    .map((row) => buildPostUseRatingRecord(row, meta))
}
