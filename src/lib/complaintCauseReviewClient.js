import { apiFetch } from './apiClient.js'

/**
 * @param {{ recordId: string; decision: 'agree' | 'reject' }[]} items
 */
export async function applyComplaintCauseReviewDecisions(items) {
  return apiFetch('/api/complaint-cause-review/apply', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

/**
 * @returns {Promise<import('../domain/complaintCauseReviewArchive.js').ComplaintCauseReviewArchiveRow[]>}
 */
export async function listComplaintCauseReviewArchives() {
  const data = await apiFetch('/api/complaint-cause-review/archive')
  return Array.isArray(data?.items) ? data.items : []
}
