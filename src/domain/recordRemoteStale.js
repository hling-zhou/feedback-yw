import { isBackgroundTaskLockHeldByUser } from './backgroundTaskLock.js'
import { getRecordRevision } from './recordRevision.js'

/** @typedef {import('./backgroundTaskLock.js').BackgroundTaskLock} BackgroundTaskLock */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('./actionItem.js').ActionItem} ActionItem */

/**
 * @typedef {{ recordRevision?: number; updatedBy?: { userId?: string } | null }} RevisionTrackedEntity
 */

/**
 * 编辑中是否应提示「他人已更新」（工单详情、举措编辑等）。
 * 批量打标/导入等同会话写入会递增 recordRevision，不应误报。
 *
 * @param {FeedbackRecord | ActionItem | RevisionTrackedEntity | null | undefined} record
 * @param {number} baseRevision 打开编辑或上次确认的版本
 * @param {{
 *   userId?: string | null
 *   retagActive?: boolean
 *   importActive?: boolean
 *   reprocessingActive?: boolean
 *   sharedBackgroundTask?: BackgroundTaskLock | null
 * }} [options]
 */
export function shouldShowRemoteRecordStale(record, baseRevision, options = {}) {
  const latestRevision = getRecordRevision(record)
  if (latestRevision <= baseRevision) return false

  const { userId, retagActive, importActive, reprocessingActive, sharedBackgroundTask } = options

  if (retagActive || importActive || reprocessingActive) return false
  if (isBackgroundTaskLockHeldByUser(sharedBackgroundTask, userId)) return false
  if (userId && record?.updatedBy?.userId === userId) return false

  return true
}
