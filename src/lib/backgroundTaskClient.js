import { apiFetch } from './apiClient.js'

/** @typedef {import('../domain/backgroundTaskLock.js').BackgroundTaskLock} BackgroundTaskLock */
/** @typedef {import('../domain/backgroundTaskLock.js').BackgroundTaskType} BackgroundTaskType */

/**
 * @returns {Promise<BackgroundTaskLock | null>}
 */
export async function fetchBackgroundTaskLock() {
  const data = await apiFetch('/api/storage/background-task')
  return data.lock ?? null
}

/**
 * @param {BackgroundTaskType} type
 * @param {{ progress?: string; meta?: Record<string, unknown> }} [payload]
 * @returns {Promise<{ lock: BackgroundTaskLock; created: boolean }>}
 */
export async function acquireBackgroundTask(type, payload = {}) {
  return apiFetch('/api/storage/background-task/acquire', {
    method: 'POST',
    body: JSON.stringify({
      type,
      progress: payload.progress,
      meta: payload.meta,
    }),
  })
}

/**
 * @param {{ progress?: string; meta?: Record<string, unknown> }} [patch]
 * @returns {Promise<BackgroundTaskLock>}
 */
export async function touchBackgroundTask(patch = {}) {
  const data = await apiFetch('/api/storage/background-task', {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.lock
}

/**
 * @returns {Promise<void>}
 */
export async function releaseBackgroundTask() {
  await apiFetch('/api/storage/background-task', { method: 'DELETE' })
}

/**
 * @param {unknown} err
 * @returns {boolean}
 */
export function isBackgroundTaskConflictError(err) {
  return Boolean(
    err &&
      typeof err === 'object' &&
      /** @type {{ status?: number }} */ (err).status === 409,
  )
}

/**
 * @param {unknown} err
 * @returns {string}
 */
export function readBackgroundTaskErrorMessage(err) {
  if (err && typeof err === 'object' && 'message' in err) {
    const msg = /** @type {{ message?: string }} */ (err).message
    if (msg) return msg
  }
  return '后台任务占锁失败'
}
