import { SCHEMA_VERSION } from '../domain/constants.js'
import { normalizeFeedbackRecord } from '../storage/feedbackStore.js'
import { EXPORT_ANALYSIS_VERSION } from './ticketAnalysisExport.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/** 当前 JSON 备份信封版本 */
export const FEEDBACK_BACKUP_VERSION = 1

/**
 * 已停写、备份中不保留的字段（Field Registry legacy · 人工复核三字段）。
 * 不剔除仍用于库内/恢复的业务字段（如 problemSummary、rootCause）。
 */
export const BACKUP_OMIT_FIELD_KEYS = [
  'manualReviewRootCause',
  'manualReviewSolution',
  'manualReviewAction',
]

/**
 * @typedef {Object} FeedbackBackupEnvelope
 * @property {number} backupVersion
 * @property {string} schemaVersion
 * @property {number} exportAnalysisVersion
 * @property {string} exportedAt
 * @property {number} recordCount
 * @property {FeedbackRecord[]} records
 */

/**
 * @typedef {Object} ParsedFeedbackBackup
 * @property {'legacy-array' | 'envelope-v1'} format
 * @property {FeedbackBackupEnvelope} [envelope]
 * @property {FeedbackRecord[]} records
 */

/**
 * @param {FeedbackRecord} record
 * @returns {FeedbackRecord}
 */
export function sanitizeRecordForBackup(record) {
  /** @type {FeedbackRecord} */
  const copy = { ...(record || {}) }
  for (const key of BACKUP_OMIT_FIELD_KEYS) {
    delete copy[key]
  }
  return normalizeFeedbackRecord(copy)
}

/**
 * @param {FeedbackRecord[]} records
 * @returns {FeedbackBackupEnvelope}
 */
export function buildFeedbackBackupEnvelope(records) {
  const sanitized = (records || []).map(sanitizeRecordForBackup)
  return {
    backupVersion: FEEDBACK_BACKUP_VERSION,
    schemaVersion: SCHEMA_VERSION,
    exportAnalysisVersion: EXPORT_ANALYSIS_VERSION,
    exportedAt: new Date().toISOString(),
    recordCount: sanitized.length,
    records: sanitized,
  }
}

/**
 * 解析 JSON 备份：支持 v1 信封或旧版纯数组。
 * @param {unknown} raw
 * @returns {ParsedFeedbackBackup}
 */
export function parseFeedbackBackupJson(raw) {
  if (Array.isArray(raw)) {
    return {
      format: 'legacy-array',
      records: raw.map((record) => sanitizeRecordForBackup(record)),
    }
  }

  if (raw && typeof raw === 'object' && Array.isArray(raw.records)) {
    return {
      format: 'envelope-v1',
      envelope: /** @type {FeedbackBackupEnvelope} */ (raw),
      records: raw.records.map((record) => sanitizeRecordForBackup(record)),
    }
  }

  throw new Error('JSON 格式应为反馈数组或 backup v1 信封（含 records 字段）')
}

/**
 * @param {FeedbackRecord[]} records
 * @param {string} [filename]
 */
export function downloadFeedbackBackupJson(records, filename = 'feedback-insights-backup.json') {
  const envelope = buildFeedbackBackupEnvelope(records)
  const blob = new Blob([JSON.stringify(envelope, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
