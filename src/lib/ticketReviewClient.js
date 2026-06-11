import { apiFetch } from './apiClient.js'

/** @typedef {import('../domain/userTicketReview.js').UserTicketReviewItem} UserTicketReviewItem */
/** @typedef {import('../domain/userTicketReview.js').UserTicketReviewSource} UserTicketReviewSource */

/**
 * @returns {Promise<UserTicketReviewItem[]>}
 */
export async function listUserTicketReviews() {
  const data = await apiFetch('/api/reviews/tickets')
  const items = Array.isArray(data?.items) ? data.items : []
  return items
    .filter((item) => item && typeof item.recordId === 'string')
    .map((item) => ({
      recordId: String(item.recordId),
      source: item.source === 'save' ? 'save' : 'manual',
      markedAt: String(item.markedAt || ''),
    }))
}

/**
 * @param {string} recordId
 * @param {UserTicketReviewSource} source
 */
export async function markUserTicketReviewDone(recordId, source) {
  const data = await apiFetch(`/api/reviews/tickets/${encodeURIComponent(recordId)}`, {
    method: 'PUT',
    body: JSON.stringify({ source }),
  })
  const item = data?.item
  return {
    recordId: String(item?.recordId || recordId),
    source: item?.source === 'save' ? 'save' : 'manual',
    markedAt: String(item?.markedAt || new Date().toISOString()),
  }
}

/**
 * @param {string} recordId
 */
export async function clearUserTicketReview(recordId) {
  await apiFetch(`/api/reviews/tickets/${encodeURIComponent(recordId)}`, {
    method: 'DELETE',
  })
}
