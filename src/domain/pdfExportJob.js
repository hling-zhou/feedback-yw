import { DATA_SOURCE_LABELS } from './enums.js'
import { randomId } from '../lib/randomId.js'

/** @typedef {'overview' | import('./enums.js').DataSourceType} PdfExportScope */

/** @typedef {'queued' | 'preparing' | 'capturing' | 'generating' | 'done' | 'failed'} PdfExportJobStatus */

/**
 * @typedef {Object} PdfExportJobPayload
 * @property {PdfExportScope} scope
 * @property {import('./insightPeriod.js').InsightPeriod | null} period
 * @property {import('./snapshot.js').OverviewSnapshot | null} [overview]
 * @property {import('./snapshot.js').InsightSnapshot | null} [sourceSnapshot]
 * @property {import('../lib/types.js').FeedbackRecord[]} feedbacks
 * @property {import('../storage/orderVolumeStore.js').OrderVolumeRow[]} [orderVolumes]
 * @property {ReturnType<import('../lib/wanTouRatio.js').buildWanTouByProducts>} [wanTouRows]
 * @property {import('../lib/types.js').FeedbackRecord[]} [complaintRecords]
 * @property {Partial<Record<import('./enums.js').DataSourceType, import('./snapshot.js').InsightSnapshot>>} [sourceSnapshots]
 * @property {string} [exportedBy]
 */

/**
 * @typedef {Object} PdfExportJob
 * @property {string} id
 * @property {PdfExportScope} scope
 * @property {PdfExportJobStatus} status
 * @property {string} label
 * @property {string} message
 * @property {PdfExportJobPayload} payload
 * @property {string} createdAt
 * @property {string} [finishedAt]
 * @property {string} [error]
 * @property {number} [chartCount]
 */

/**
 * @param {PdfExportScope} scope
 */
export function pdfExportScopeLabel(scope) {
  if (scope === 'overview') return '综合概述报告'
  return `${DATA_SOURCE_LABELS[scope] || scope}报告`
}

/**
 * @param {PdfExportJobPayload} payload
 * @returns {PdfExportJob}
 */
export function createPdfExportJob(payload) {
  return {
    id: randomId(),
    scope: payload.scope,
    status: 'queued',
    label: pdfExportScopeLabel(payload.scope),
    message: '排队中…',
    payload,
    createdAt: new Date().toISOString(),
  }
}

/**
 * @param {PdfExportJob} job
 * @param {Partial<PdfExportJob>} patch
 * @returns {PdfExportJob}
 */
export function patchPdfExportJob(job, patch) {
  return { ...job, ...patch }
}
