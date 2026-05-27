import { apiFetch } from './apiClient.js'

/** 轮询间隔（毫秒） */
export const DATA_SYNC_POLL_MS = 5000

/**
 * @returns {Promise<{ revision: number; updatedAt: string | null }>}
 */
export async function fetchDataRevision() {
  return apiFetch('/api/storage/revision')
}
