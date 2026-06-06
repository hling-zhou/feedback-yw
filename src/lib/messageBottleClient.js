import { apiFetch } from './apiClient.js'

/**
 * @param {{ content: string; attachments?: import('../domain/messageBottle.js').MessageBottleAttachment[] }} payload
 */
export function submitMessageBottle(payload) {
  return apiFetch('/api/message-bottles', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/**
 * @param {{ limit?: number; offset?: number }} [query]
 */
export function listMessageBottles(query = {}) {
  const params = new URLSearchParams()
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const qs = params.toString()
  return apiFetch(`/api/message-bottles${qs ? `?${qs}` : ''}`)
}

/**
 * @param {string} id
 * @param {string} progress
 */
export function updateMessageBottleProgress(id, progress) {
  return apiFetch(`/api/message-bottles/${encodeURIComponent(id)}/progress`, {
    method: 'PATCH',
    body: JSON.stringify({ progress }),
  })
}

/**
 * @param {File} file
 * @returns {Promise<import('../domain/messageBottle.js').MessageBottleAttachment>}
 */
export function readMessageBottleAttachment(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      resolve({
        dataUrl: String(reader.result),
        fileName: file.name || 'screenshot.png',
        mimeType: file.type || 'image/png',
        size: file.size,
      })
    }
    reader.onerror = () => reject(reader.error || new Error('读取附件失败'))
    reader.readAsDataURL(file)
  })
}
