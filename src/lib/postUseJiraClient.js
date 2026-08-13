import { apiFetch } from './apiClient.js'

/**
 * @returns {Promise<{ items: Array<{
 *   itemKey: string
 *   sourceType?: string
 *   needCustomerVisit?: boolean
 *   needInternalTrace?: boolean
 * }> }>}
 */
export function listPostUseCallbackDecisions() {
  return apiFetch('/api/post-use-callback-decisions')
}

/**
 * @param {Array<{
 *   itemKey: string
 *   sourceType?: string
 *   needCustomerVisit?: boolean
 *   needInternalTrace?: boolean
 * }>} items
 */
export function upsertPostUseCallbackDecisions(items) {
  return apiFetch('/api/post-use-callback-decisions', {
    method: 'PUT',
    body: JSON.stringify({ items }),
  })
}

/**
 * @param {{
 *   importMonth?: string
 *   productName?: string
 *   status?: string
 *   search?: string
 *   limit?: number
 *   offset?: number
 * }} [query]
 */
export function listPostUseJiraItems(query = {}) {
  const params = new URLSearchParams()
  if (query.importMonth) params.set('importMonth', query.importMonth)
  if (query.productName) params.set('productName', query.productName)
  if (query.status) params.set('status', query.status)
  if (query.search) params.set('search', query.search)
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const qs = params.toString()
  return apiFetch(`/api/post-use-jira${qs ? `?${qs}` : ''}`)
}

/**
 * @param {Array<Record<string, unknown>>} items
 */
export function archivePostUseJiraItems(items) {
  return apiFetch('/api/post-use-jira', {
    method: 'POST',
    body: JSON.stringify({ items }),
  })
}

/**
 * @param {string} id
 * @param {{ jiraTicket?: string; status?: string; progress?: string }} patch
 */
export function patchPostUseJiraItem(id, patch) {
  return apiFetch(`/api/post-use-jira/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/** @param {string} id */
export function deletePostUseJiraItem(id) {
  return apiFetch(`/api/post-use-jira/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/** @param {string[]} ids */
export function deletePostUseJiraItems(ids) {
  return apiFetch('/api/post-use-jira/batch-delete', {
    method: 'POST',
    body: JSON.stringify({ ids }),
  })
}
