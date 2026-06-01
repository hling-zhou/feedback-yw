/** @typedef {import('./actionItem.js').ActionItem} ActionItem */

/**
 * @typedef {Object} PutActionItemOptions
 * @property {number} [expectedRevision]
 * @property {boolean} [skipConflictCheck]
 */

export const ACTION_ITEM_CONFLICT_CODE = 'ACTION_ITEM_CONFLICT'

/**
 * @typedef {Object} ActionItemUpdatedBy
 * @property {string} userId
 * @property {string} username
 */

/**
 * @param {ActionItem | null | undefined} item
 * @returns {number}
 */
export function getActionItemRevision(item) {
  const n = Number(item?.recordRevision)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.floor(n)
}

/**
 * @param {ActionItem} item
 * @param {{ previousRevision?: number; actor?: ActionItemUpdatedBy | null }} [options]
 * @returns {ActionItem}
 */
export function applyActionItemWriteMetadata(item, options = {}) {
  const previousRevision = options.previousRevision ?? getActionItemRevision(item)
  const now = new Date().toISOString()
  return {
    ...item,
    recordRevision: previousRevision + 1,
    updatedAt: now,
    ...(options.actor
      ? { updatedBy: { userId: options.actor.userId, username: options.actor.username } }
      : {}),
  }
}

export class ActionItemConflictError extends Error {
  /**
   * @param {string} message
   * @param {{ current: ActionItem | null; currentRevision: number }} details
   */
  constructor(message, details) {
    super(message)
    this.name = 'ActionItemConflictError'
    this.code = ACTION_ITEM_CONFLICT_CODE
    this.current = details.current
    this.currentRevision = details.currentRevision
  }
}

/**
 * @param {unknown} err
 * @returns {ActionItemConflictError | null}
 */
export function toActionItemConflictError(err) {
  if (err instanceof ActionItemConflictError) return err
  if (!err || typeof err !== 'object') return null
  const e = /** @type {Record<string, unknown> & { message?: string; data?: Record<string, unknown> }} */ (
    err
  )
  const data = e.data && typeof e.data === 'object' ? e.data : e
  if (data.code !== ACTION_ITEM_CONFLICT_CODE) return null
  const current = /** @type {ActionItem | null} */ (data.current ?? null)
  return new ActionItemConflictError(
    String(data.error || e.message || '举措已被他人更新'),
    {
      current,
      currentRevision: Number(data.currentRevision ?? getActionItemRevision(current)),
    },
  )
}

/**
 * @param {ActionItem | null | undefined} item
 * @returns {string}
 */
export function formatActionItemUpdatedByLine(item) {
  if (!item?.updatedAt) return ''
  const who = item.updatedBy?.username?.trim()
  const at = item.updatedAt.replace('T', ' ').slice(0, 19)
  return who ? `${who} · ${at}` : at
}
