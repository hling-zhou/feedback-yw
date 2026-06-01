/** @typedef {'import' | 'retag'} BackgroundTaskType */

/**
 * @typedef {Object} BackgroundTaskLock
 * @property {string} id
 * @property {BackgroundTaskType} type
 * @property {string} userId
 * @property {string} username
 * @property {string} startedAt ISO 8601
 * @property {string} updatedAt ISO 8601
 * @property {string} [progress]
 * @property {Record<string, unknown>} [meta]
 */

export const META_KEY_BACKGROUND_TASK_LOCK = 'background_task_lock'

/** 无心跳超过此时间视为可抢占。需大于单次 LLM 批次最慢耗时，避免任务进行中被误释放。 */
export const BACKGROUND_TASK_STALE_MS = 3 * 60 * 1000

/** 最长占用时间，防止异常退出后永久占锁 */
export const BACKGROUND_TASK_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {number} [nowMs]
 */
export function isBackgroundTaskLockExpired(lock, nowMs = Date.now()) {
  if (!lock?.startedAt) return true
  const started = Date.parse(lock.startedAt)
  if (!Number.isFinite(started)) return true
  return nowMs - started > BACKGROUND_TASK_MAX_AGE_MS
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {number} [nowMs]
 */
export function isBackgroundTaskLockStale(lock, nowMs = Date.now()) {
  if (!lock) return true
  if (isBackgroundTaskLockExpired(lock, nowMs)) return true
  const updated = Date.parse(lock.updatedAt || lock.startedAt)
  if (!Number.isFinite(updated)) return true
  return nowMs - updated > BACKGROUND_TASK_STALE_MS
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {number} [nowMs]
 */
export function isBackgroundTaskLockActive(lock, nowMs = Date.now()) {
  return Boolean(lock?.id && !isBackgroundTaskLockStale(lock, nowMs))
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 * @param {string | null | undefined} userId
 */
export function isBackgroundTaskLockHeldByUser(lock, userId) {
  return Boolean(lock?.userId && userId && lock.userId === userId)
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function formatBackgroundTaskBlockedTip(lock) {
  if (!lock) return '其他用户正在执行后台任务，请稍后再试'
  const who = lock.username?.trim() || '其他用户'
  if (lock.type === 'import') {
    return `${who} 正在进行数据导入，请待完成后再试`
  }
  if (lock.type === 'retag') {
    return `${who} 正在进行批量重新打标，请待完成后再试`
  }
  return `${who} 正在执行后台任务，请稍后再试`
}

/**
 * @param {BackgroundTaskLock | null | undefined} lock
 */
export function formatBackgroundTaskRemoteBanner(lock) {
  if (!lock) return ''
  const who = lock.username?.trim() || '其他用户'
  const progress = lock.progress?.trim()
  if (lock.type === 'import') {
    const month = lock.meta?.dataMonth
    const parts = [`${who} 正在导入数据`]
    if (month) parts.push(`数据月份 ${month}`)
    if (progress) parts.push(progress)
    return parts.join(' · ')
  }
  if (lock.type === 'retag') {
    const total = lock.meta?.total
    const parts = [`${who} 正在批量重新打标`]
    if (total) parts.push(`共 ${total} 条`)
    if (progress) parts.push(progress)
    return parts.join(' · ')
  }
  return progress ? `${who} · ${progress}` : `${who} 正在执行后台任务`
}

/**
 * @param {BackgroundTaskType} type
 */
export function backgroundTaskTypeLabel(type) {
  return type === 'import' ? '数据导入' : type === 'retag' ? '批量重新打标' : '后台任务'
}
