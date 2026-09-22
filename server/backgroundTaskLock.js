import { randomId } from '../src/lib/randomId.js'
import {
  META_KEY_BACKGROUND_TASK_LOCK,
  META_KEY_BACKGROUND_TASK_HISTORY,
  META_KEY_BACKGROUND_TASK_RESULT,
  META_KEY_BACKGROUND_TASK_CANCEL,
  BACKGROUND_TASK_HISTORY_LIMIT,
  isBackgroundTaskLockActive,
  isBackgroundTaskLockHeldByUser,
  isBackgroundTaskLockStale,
} from '../src/domain/backgroundTaskLock.js'
import { storageRepository } from './storageRepository.js'

// 重新导出供路由层使用
export { isBackgroundTaskLockHeldByUser }

/** @typedef {import('../src/domain/backgroundTaskLock.js').BackgroundTaskLock} BackgroundTaskLock */
/** @typedef {import('../src/domain/backgroundTaskLock.js').BackgroundTaskType} BackgroundTaskType */

/**
 * @returns {BackgroundTaskLock | null}
 */
export function getBackgroundTaskLock() {
  const raw = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_LOCK)
  if (!raw || typeof raw !== 'object') return null
  const lock = /** @type {BackgroundTaskLock} */ (raw)
  if (!isBackgroundTaskLockActive(lock)) {
    if (lock?.id) clearBackgroundTaskLock()
    return null
  }
  return lock
}

function clearBackgroundTaskLock() {
  storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_LOCK)
}

/**
 * @param {BackgroundTaskLock} lock
 */
function saveBackgroundTaskLock(lock) {
  storageRepository.putMeta(META_KEY_BACKGROUND_TASK_LOCK, lock)
}

/**
 * @param {BackgroundTaskType} type
 * @param {{ id: string; username: string; progress?: string; meta?: Record<string, unknown> }} owner
 * @returns {{ lock: BackgroundTaskLock; created: boolean }}
 */
export function acquireBackgroundTaskLock(type, owner) {
  const now = new Date().toISOString()
  const existing = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_LOCK)
  const current =
    existing && typeof existing === 'object'
      ? /** @type {BackgroundTaskLock} */ (existing)
      : null

  if (current?.id && isBackgroundTaskLockActive(current)) {
    if (isBackgroundTaskLockHeldByUser(current, owner.id)) {
      const refreshed = {
        ...current,
        type,
        username: owner.username,
        updatedAt: now,
        progress: owner.progress ?? current.progress,
        meta: owner.meta ?? current.meta,
      }
      saveBackgroundTaskLock(refreshed)
      return { lock: refreshed, created: false }
    }
    const err = new Error(formatAcquireConflictMessage(current))
    err.code = 'BACKGROUND_TASK_CONFLICT'
    err.lock = current
    throw err
  }

  if (current?.id && isBackgroundTaskLockStale(current)) {
    clearBackgroundTaskLock()
  }

  const lock = {
    id: randomId(),
    type,
    userId: owner.id,
    username: owner.username,
    startedAt: now,
    updatedAt: now,
    progress: owner.progress,
    meta: owner.meta,
  }
  saveBackgroundTaskLock(lock)
  return { lock, created: true }
}

/**
 * @param {BackgroundTaskLock} lock
 */
function formatAcquireConflictMessage(lock) {
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
 * @param {string} userId
 * @param {{ progress?: string; meta?: Record<string, unknown> }} [patch]
 * @returns {BackgroundTaskLock}
 */
export function touchBackgroundTaskLock(userId, patch = {}) {
  const lock = getBackgroundTaskLock()
  if (!lock) {
    throw new Error('当前无进行中的后台任务')
  }
  if (!isBackgroundTaskLockHeldByUser(lock, userId)) {
    const err = new Error('无权更新该后台任务')
    err.code = 'BACKGROUND_TASK_FORBIDDEN'
    throw err
  }
  const next = {
    ...lock,
    updatedAt: new Date().toISOString(),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(patch.meta !== undefined ? { meta: { ...lock.meta, ...patch.meta } } : {}),
  }
  saveBackgroundTaskLock(next)
  return next
}

/**
 * @param {string} userId
 * @param {{ force?: boolean }} [options]
 */
export function releaseBackgroundTaskLock(userId, options = {}) {
  const lock = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_LOCK)
  if (!lock || typeof lock !== 'object') return false
  const current = /** @type {BackgroundTaskLock} */ (lock)
  if (
    !options.force &&
    current.userId &&
    userId &&
    current.userId !== userId
  ) {
    const err = new Error('无权释放该后台任务')
    err.code = 'BACKGROUND_TASK_FORBIDDEN'
    throw err
  }
  clearBackgroundTaskLock()
  return true
}

/**
 * @typedef {Object} TaskHistoryEntry
 * @property {string} id
 * @property {BackgroundTaskType} type
 * @property {string} source
 * @property {string} [scope]
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {'success' | 'failed'} status
 * @property {Record<string, unknown>} [summary]
 * @property {string} [error]
 * @property {string} [username]
 */

/**
 * @returns {TaskHistoryEntry[]}
 */
export function getTaskHistory() {
  const raw = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_HISTORY)
  if (!Array.isArray(raw)) return []
  return raw
}

/**
 * @param {TaskHistoryEntry} entry
 */
export function appendTaskHistory(entry) {
  const history = getTaskHistory()
  history.unshift(entry)
  const trimmed = history.slice(0, BACKGROUND_TASK_HISTORY_LIMIT)
  storageRepository.putMeta(META_KEY_BACKGROUND_TASK_HISTORY, trimmed)
}

// ─── 任务结果（独立于 lock，解决关页签后锁残留问题） ───

/**
 * @param {Record<string, unknown>} result
 */
export function setTaskResult(result) {
  storageRepository.putMeta(META_KEY_BACKGROUND_TASK_RESULT, result)
}

/**
 * @returns {Record<string, unknown> | null}
 */
export function getTaskResult() {
  const raw = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_RESULT)
  if (!raw || typeof raw !== 'object') return null
  return /** @type {Record<string, unknown>} */ (raw)
}

export function clearTaskResult() {
  storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_RESULT)
}

// ─── 取消标志（协作式取消，方案 A：不写盘） ───

/**
 * @returns {boolean}
 */
export function isTaskCancelled() {
  return Boolean(storageRepository.getMeta(META_KEY_BACKGROUND_TASK_CANCEL))
}

export function setTaskCancelled() {
  storageRepository.putMeta(META_KEY_BACKGROUND_TASK_CANCEL, true)
}

export function clearTaskCancelled() {
  storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_CANCEL)
}
