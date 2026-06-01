/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * @typedef {Object} PutRecordOptions
 * @property {number} [expectedRevision]
 * @property {boolean} [skipConflictCheck]
 * @property {boolean} [forceOverwrite]
 */

export const RECORD_CONFLICT_CODE = 'RECORD_CONFLICT'

/**
 * @typedef {Object} RecordUpdatedBy
 * @property {string} userId
 * @property {string} username
 */

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {number}
 */
export function getRecordRevision(record) {
  const n = Number(record?.recordRevision)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/**
 * @param {FeedbackRecord} record
 * @param {{ previousRevision?: number; actor?: RecordUpdatedBy | null }} [options]
 * @returns {FeedbackRecord}
 */
export function applyRecordWriteMetadata(record, options = {}) {
  const previousRevision = options.previousRevision ?? getRecordRevision(record)
  const now = new Date().toISOString()
  return {
    ...record,
    recordRevision: previousRevision + 1,
    updatedAt: now,
    ...(options.actor
      ? { updatedBy: { userId: options.actor.userId, username: options.actor.username } }
      : {}),
  }
}

export class RecordConflictError extends Error {
  /**
   * @param {string} message
   * @param {{ current: FeedbackRecord | null; currentRevision: number }} details
   */
  constructor(message, details) {
    super(message)
    this.name = 'RecordConflictError'
    this.code = RECORD_CONFLICT_CODE
    this.current = details.current
    this.currentRevision = details.currentRevision
  }
}

/**
 * @param {unknown} err
 * @returns {err is RecordConflictError}
 */
export function isRecordConflictError(err) {
  return (
    err instanceof RecordConflictError ||
    (Boolean(err) &&
      typeof err === 'object' &&
      /** @type {{ code?: string }} */ (err).code === RECORD_CONFLICT_CODE)
  )
}

/**
 * @param {unknown} err
 * @returns {RecordConflictError | null}
 */
export function toRecordConflictError(err) {
  if (err instanceof RecordConflictError) return err
  if (!err || typeof err !== 'object') return null
  const e = /** @type {Record<string, unknown> & { message?: string; data?: Record<string, unknown> }} */ (
    err
  )
  const data = e.data && typeof e.data === 'object' ? e.data : e
  if (data.code !== RECORD_CONFLICT_CODE) return null
  const current = /** @type {FeedbackRecord | null} */ (data.current ?? null)
  return new RecordConflictError(
    String(data.error || e.message || '记录已被他人更新'),
    {
      current,
      currentRevision: Number(data.currentRevision ?? getRecordRevision(current)),
    },
  )
}
