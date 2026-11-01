import { isBackgroundTaskLockHeldByUser } from './backgroundTaskLock.js'
import { getRecordRevision } from './recordRevision.js'

/** @typedef {import('./backgroundTaskLock.js').BackgroundTaskLock} BackgroundTaskLock */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('./actionItem.js').ActionItem} ActionItem */

/**
 * @typedef {{ recordRevision?: number; updatedBy?: { userId?: string } | null }} RevisionTrackedEntity
 */

/**
 * 编辑中是否应提示「记录已被更新」（工单详情、举措编辑等）。
 * 批量打标/导入等同会话写入会递增 recordRevision，不应误报。
 *
 * 2026-11-01 分级提示（docs/DESIGN-drawer-ux-20261101.md §4-5）：
 * - 'other'    → 他人更新：warning 黄条（原文案保留）；
 * - 'own_task' → 自己发起的批量任务更新：info 蓝条（信息型措辞，无「他人/覆盖」警示语）；
 * - false      → 不提示（版本未推进 / 自己单人保存回显）。
 *
 * @param {FeedbackRecord | ActionItem | RevisionTrackedEntity | null | undefined} record
 * @param {number} baseRevision 打开编辑或上次确认的版本
 * @param {{
 *   userId?: string | null
 *   retagActive?: boolean
 *   importActive?: boolean
 *   reprocessingActive?: boolean
 *   sharedBackgroundTask?: BackgroundTaskLock | null
 *   sharedBackgroundTasks?: BackgroundTaskLock[]
 * }} [options]
 * @returns {false | 'other' | 'own_task'}
 */
export function shouldShowRemoteRecordStale(record, baseRevision, options = {}) {
  const latestRevision = getRecordRevision(record)
  if (latestRevision <= baseRevision) return false

  const { userId, retagActive, importActive, reprocessingActive, sharedBackgroundTask, sharedBackgroundTasks } = options
  const tasks = sharedBackgroundTasks || (sharedBackgroundTask ? [sharedBackgroundTask] : [])

  // 自己发起的批量任务（本机会话进行中 / 自己持有共享任务锁）更新了记录 → 分级为 own_task
  // 注意：任务回写的 updatedBy 也是自己，须先于"同人静默"判断
  const ownTaskActive =
    retagActive || importActive || reprocessingActive ||
    tasks.some((task) => isBackgroundTaskLockHeldByUser(task, userId))
  if (ownTaskActive) return 'own_task'

  if (userId && record?.updatedBy?.userId === userId) return false

  return 'other'
}
