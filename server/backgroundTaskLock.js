import { randomId } from '../src/lib/randomId.js'
import {
  META_KEY_BACKGROUND_TASK_LOCK,
  META_KEY_BACKGROUND_TASKS,
  META_KEY_BACKGROUND_TASK_HISTORY,
  META_KEY_BACKGROUND_TASK_RESULT,
  META_KEY_BACKGROUND_TASK_RESULTS,
  BACKGROUND_TASK_HISTORY_LIMIT,
  BACKGROUND_TASK_PHASE_CLIENT,
  isBackgroundTaskLockActive,
  isBackgroundTaskLockHeldByUser,
  isBackgroundTaskLockStale,
  findConflictingBackgroundTask,
  backgroundTaskTypeLabel,
} from '../src/domain/backgroundTaskLock.js'
import { storageRepository } from './storageRepository.js'

export { isBackgroundTaskLockHeldByUser }

/** @typedef {import('../src/domain/backgroundTaskLock.js').BackgroundTaskLock} BackgroundTaskLock */
/** @typedef {import('../src/domain/backgroundTaskLock.js').BackgroundTaskType} BackgroundTaskType */

/**
 * @returns {BackgroundTaskLock[]}
 */
function readStoredTasks() {
  const raw = storageRepository.getMeta(META_KEY_BACKGROUND_TASKS)
  const list = Array.isArray(raw) ? /** @type {BackgroundTaskLock[]} */ (raw) : []
  if (list.length) return list
  const legacy = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_LOCK)
  if (legacy && typeof legacy === 'object' && /** @type {BackgroundTaskLock} */ (legacy).id) {
    return [/** @type {BackgroundTaskLock} */ (legacy)]
  }
  return []
}

/**
 * @param {BackgroundTaskLock[]} tasks
 */
function saveTasks(tasks) {
  storageRepository.putMeta(META_KEY_BACKGROUND_TASKS, tasks)
  storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_LOCK)
}

/**
 * 丢掉过期任务，返回仍有效的列表。
 * @returns {BackgroundTaskLock[]}
 */
export function listBackgroundTasks() {
  const stored = readStoredTasks()
  const active = []
  let dropped = false
  for (const task of stored) {
    if (isBackgroundTaskLockActive(task) && !isBackgroundTaskLockStale(task)) {
      active.push(task)
    } else {
      dropped = true
    }
  }
  if (dropped || stored.length !== active.length) saveTasks(active)
  return active
}

/**
 * 兼容旧调用：没有进行中任务时返回 null。多个任务时返回最近开始的一条，新代码请用 listBackgroundTasks。
 * @returns {BackgroundTaskLock | null}
 */
export function getBackgroundTaskLock() {
  const tasks = listBackgroundTasks()
  return tasks[0] || null
}

/**
 * @param {BackgroundTaskType} type
 * @param {{ id: string; username: string; progress?: string; meta?: Record<string, unknown> }} owner
 * @returns {{ lock: BackgroundTaskLock; created: boolean }}
 */
export function acquireBackgroundTaskLock(type, owner) {
  const now = new Date().toISOString()
  const tasks = listBackgroundTasks()
  const incoming = { type, meta: owner.meta }
  const conflict = findConflictingBackgroundTask(tasks, incoming)
  if (conflict) {
    const err = new Error(formatAcquireConflictMessage(conflict))
    err.code = 'BACKGROUND_TASK_CONFLICT'
    err.lock = conflict
    throw err
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
  saveTasks([...tasks, lock])
  return { lock, created: true }
}

/**
 * @param {BackgroundTaskLock} lock
 */
function formatAcquireConflictMessage(lock) {
  const who = lock.username?.trim() || '其他用户'
  const month = lock.meta?.dataMonth ? `（${lock.meta.dataMonth}）` : ''
  if (lock.type === 'import') {
    return `${who} 正在导入${month}数据，请待完成后再试`
  }
  if (lock.type === 'retag') {
    return `${who} 正在进行批量重新打标，请待完成后再试`
  }
  return `${who} 正在执行后台任务，请稍后再试`
}

/**
 * @param {string} taskId
 * @returns {BackgroundTaskLock | null}
 */
export function getBackgroundTask(taskId) {
  return listBackgroundTasks().find((task) => task.id === taskId) || null
}

/**
 * @param {string} taskId
 * @param {{ progress?: string; meta?: Record<string, unknown> }} [patch]
 * @returns {BackgroundTaskLock}
 */
export function touchBackgroundTask(taskId, patch = {}) {
  const tasks = listBackgroundTasks()
  const index = tasks.findIndex((task) => task.id === taskId)
  if (index < 0) {
    throw new Error('当前无进行中的后台任务')
  }
  const lock = tasks[index]
  const next = {
    ...lock,
    updatedAt: new Date().toISOString(),
    ...(patch.progress !== undefined ? { progress: patch.progress } : {}),
    ...(patch.meta !== undefined ? { meta: { ...lock.meta, ...patch.meta } } : {}),
  }
  const updated = [...tasks]
  updated[index] = next
  saveTasks(updated)
  return next
}

/**
 * 按用户更新其持有的任务。多条时必须带 taskId。
 * @param {string} userId
 * @param {{ progress?: string; meta?: Record<string, unknown>; taskId?: string }} [patch]
 */
export function touchBackgroundTaskLock(userId, patch = {}) {
  const tasks = listBackgroundTasks().filter((task) => isBackgroundTaskLockHeldByUser(task, userId))
  const lock = patch.taskId ? tasks.find((task) => task.id === patch.taskId) : tasks[0]
  if (!lock) {
    throw new Error('当前无进行中的后台任务')
  }
  return touchBackgroundTask(lock.id, patch)
}

/**
 * @param {string} taskId
 * @param {string} [userId]
 * @param {{ force?: boolean }} [options]
 */
export function releaseBackgroundTask(taskId, userId, options = {}) {
  const tasks = readStoredTasks()
  const current = tasks.find((task) => task.id === taskId)
  if (!current) return false
  if (!options.force && current.userId && userId && current.userId !== userId) {
    const err = new Error('无权释放该后台任务')
    err.code = 'BACKGROUND_TASK_FORBIDDEN'
    throw err
  }
  saveTasks(tasks.filter((task) => task.id !== taskId))
  return true
}

/**
 * @param {string} userId
 * @param {{ force?: boolean; taskId?: string }} [options]
 */
export function releaseBackgroundTaskLock(userId, options = {}) {
  const tasks = listBackgroundTasks().filter((task) => isBackgroundTaskLockHeldByUser(task, userId))
  const lock = options.taskId ? tasks.find((task) => task.id === options.taskId) : tasks[0]
  if (!lock) return false
  return releaseBackgroundTask(lock.id, userId, options)
}

/**
 * @typedef {Object} TaskHistoryEntry
 * @property {string} id
 * @property {BackgroundTaskType} type
 * @property {string} source
 * @property {string} [scope]
 * @property {string} startedAt
 * @property {string} endedAt
 * @property {'success' | 'failed' | 'cancelled'} status
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

/**
 * @returns {Record<string, Record<string, unknown>>}
 */
function readResultMap() {
  const raw = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_RESULTS)
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    return /** @type {Record<string, Record<string, unknown>>} */ (raw)
  }
  const legacy = storageRepository.getMeta(META_KEY_BACKGROUND_TASK_RESULT)
  if (legacy && typeof legacy === 'object') {
    const taskId = /** @type {{ taskId?: string }} */ (legacy).taskId || 'legacy'
    return { [taskId]: /** @type {Record<string, unknown>} */ (legacy) }
  }
  return {}
}

/**
 * @param {string} taskId
 * @param {Record<string, unknown>} result
 */
export function setTaskResult(taskId, result) {
  const map = readResultMap()
  map[taskId] = { ...result, taskId }
  storageRepository.putMeta(META_KEY_BACKGROUND_TASK_RESULTS, map)
  storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_RESULT)
}

/**
 * @returns {Record<string, unknown>[]}
 */
export function listTaskResults() {
  return Object.values(readResultMap())
}

/**
 * @param {string} [taskId] 不传则清空全部（兼容旧接口）
 */
export function clearTaskResult(taskId) {
  if (!taskId) {
    storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_RESULTS)
    storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_RESULT)
    return
  }
  const map = readResultMap()
  delete map[taskId]
  storageRepository.putMeta(META_KEY_BACKGROUND_TASK_RESULTS, map)
  storageRepository.deleteMeta(META_KEY_BACKGROUND_TASK_RESULT)
}

/** @deprecated 使用 listTaskResults */
export function getTaskResult() {
  const list = listTaskResults()
  return list[0] || null
}

/**
 * @param {string} taskId
 */
export function isTaskCancelled(taskId) {
  if (!taskId) return false
  const task = getBackgroundTask(taskId)
  return Boolean(task?.meta?.cancelled)
}

/**
 * 服务端任务协作式取消；仍在浏览器执行的任务立即收尾。
 * @param {string} userId
 * @param {string} taskId
 */
export function requestBackgroundTaskCancel(userId, taskId) {
  const lock = getBackgroundTask(taskId)
  if (!lock) {
    const err = new Error('当前无进行中的后台任务')
    err.code = 'BACKGROUND_TASK_NOT_FOUND'
    throw err
  }
  if (!isBackgroundTaskLockHeldByUser(lock, userId)) {
    const err = new Error('无权取消其他用户的后台任务')
    err.code = 'BACKGROUND_TASK_FORBIDDEN'
    throw err
  }

  const updated = touchBackgroundTask(lock.id, {
    progress: '正在取消…',
    meta: { cancelled: true },
  })

  const clientPhase = updated.meta?.phase === BACKGROUND_TASK_PHASE_CLIENT
  if (!clientPhase) {
    return {
      finalized: false,
      lock: updated,
      message: '取消信号已发送，任务将在当前记录处理完后终止',
    }
  }

  try {
    appendTaskHistory({
      id: updated.id,
      type: updated.type,
      source: backgroundTaskTypeLabel(updated.type),
      scope: typeof updated.meta?.scope === 'string' ? updated.meta.scope : undefined,
      startedAt: updated.startedAt,
      endedAt: new Date().toISOString(),
      status: 'cancelled',
      summary: updated.meta?.total != null ? { total: updated.meta.total } : undefined,
      username: updated.username,
    })
  } catch (err) {
    console.warn('[backgroundTask] 写入取消历史失败:', err)
  }

  releaseBackgroundTask(updated.id, userId)
  return {
    finalized: true,
    lock: null,
    message: '任务已取消',
  }
}
