import { apiFetch, getStoredToken } from './apiClient.js'

const BASE = '/api/post-use-attachments'

/** @param {'trace' | 'visit'} ownerType @param {string} ownerId @param {number} [page] @param {number} [pageSize] */
export function listPostUseAttachments(ownerType, ownerId, page = 1, pageSize = 50) {
  const query = new URLSearchParams({ limit: String(pageSize), offset: String((page - 1) * pageSize) })
  return apiFetch(BASE + '/' + ownerType + '/' + encodeURIComponent(ownerId) + '?' + query)
}

/**
 * 每个请求只发送一个小分片，附件总大小由文件与存储空间决定。
 * @param {'trace' | 'visit'} ownerType
 * @param {string} ownerId
 * @param {File} file
 * @param {(percent: number) => void} [onProgress]
 * @param {AbortSignal} [signal]
 */
export async function uploadPostUseAttachment(ownerType, ownerId, file, onProgress, signal) {
  const upload = await apiFetch(BASE + '/' + ownerType + '/' + encodeURIComponent(ownerId) + '/uploads', {
    method: 'POST',
    body: JSON.stringify({ filename: file.name, sizeBytes: file.size }),
    signal,
  })
  try {
    const chunkBytes = Number(upload.chunkBytes)
    if (!Number.isSafeInteger(chunkBytes) || chunkBytes <= 0) throw new Error('上传分片配置无效')
    for (let index = 0, offset = 0; offset < file.size; index += 1, offset += chunkBytes) {
      const chunk = await file.slice(offset, offset + chunkBytes).arrayBuffer()
      await apiFetch(BASE + '/uploads/' + encodeURIComponent(upload.id) + '/chunks/' + index, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: chunk,
        signal,
      })
      onProgress?.(Math.round(Math.min(1, (offset + chunk.byteLength) / file.size) * 100))
    }
    const completed = await apiFetch(BASE + '/uploads/' + encodeURIComponent(upload.id) + '/complete', {
      method: 'POST',
      signal,
    })
    onProgress?.(100)
    return completed.item
  } catch (error) {
    try {
      await apiFetch(BASE + '/uploads/' + encodeURIComponent(upload.id), { method: 'DELETE' })
    } catch {
      // 断网时由服务端过期会话清理。
    }
    throw error
  }
}

/** @param {string} id */
export function deletePostUseAttachment(id) {
  return apiFetch(BASE + '/files/' + encodeURIComponent(id), { method: 'DELETE' })
}

/** @param {string} id @param {boolean} [inline] */
export async function fetchPostUseAttachment(id, inline = false) {
  const token = getStoredToken()
  const response = await fetch(BASE + '/files/' + encodeURIComponent(id) + (inline ? '?inline=1' : ''), {
    headers: token ? { Authorization: 'Bearer ' + token } : {},
  })
  if (!response.ok) {
    let error = '获取附件失败'
    try { error = (await response.json())?.error || error } catch { /* ignore */ }
    throw new Error(error)
  }
  return response.blob()
}
