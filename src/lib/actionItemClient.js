import { apiFetch } from './apiClient.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */

/**
 * @typedef {Object} ActionItemListQuery
 * @property {string} [productKey]
 * @property {string} [productKeys]
 * @property {ActionItemStatus} [status]
 * @property {string} [statuses]
 * @property {string} [ticketId]
 * @property {string} [firstProposedFrom]
 * @property {string} [firstProposedTo]
 * @property {string} [search]
 * @property {number} [limit]
 * @property {number} [offset]
 */

/**
 * @typedef {Object} ActionItemListResult
 * @property {ActionItem[]} items
 * @property {number} total
 * @property {number} limit
 * @property {number} offset
 */

/**
 * @param {ActionItemListQuery} [query]
 * @returns {Promise<ActionItemListResult>}
 */
export async function listActionItems(query = {}) {
  const params = new URLSearchParams()
  if (query.productKey) params.set('productKey', query.productKey)
  if (query.productKeys) params.set('productKeys', query.productKeys)
  if (query.status) params.set('status', query.status)
  if (query.statuses) params.set('statuses', query.statuses)
  if (query.ticketId) params.set('ticketId', query.ticketId)
  if (query.firstProposedFrom) params.set('firstProposedFrom', query.firstProposedFrom)
  if (query.firstProposedTo) params.set('firstProposedTo', query.firstProposedTo)
  if (query.search) params.set('search', query.search)
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const qs = params.toString()
  return apiFetch(`/api/actions${qs ? `?${qs}` : ''}`)
}

/**
 * @returns {Promise<{ counts: Record<ActionItemStatus, number> }>}
 */
export async function getActionItemStats() {
  return apiFetch('/api/actions/stats')
}

/**
 * @param {string} id
 * @returns {Promise<ActionItem | null>}
 */
export async function getActionItem(id) {
  try {
    const data = await apiFetch(`/api/actions/${encodeURIComponent(id)}`)
    return data.item ?? null
  } catch (err) {
    if (err && typeof err === 'object' && /** @type {{ status?: number }} */ (err).status === 404) {
      return null
    }
    throw err
  }
}

/**
 * @param {Partial<ActionItem>} input
 * @returns {Promise<ActionItem>}
 */
export async function createActionItem(input) {
  const data = await apiFetch('/api/actions', {
    method: 'POST',
    body: JSON.stringify(input),
  })
  return data.item
}

/**
 * @param {string} id
 * @param {Partial<ActionItem>} patch
 * @returns {Promise<ActionItem>}
 */
export async function updateActionItem(id, patch) {
  const data = await apiFetch(`/api/actions/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
  return data.item
}

/**
 * @param {string} id
 * @returns {Promise<void>}
 */
export async function deleteActionItem(id) {
  await apiFetch(`/api/actions/${encodeURIComponent(id)}`, { method: 'DELETE' })
}

/**
 * 强制覆盖 / 解关联：从举措库 linkedTicketIds 移除工单，不删除举措。
 *
 * @param {{ actionId: string; ticketId: string }[]} links
 * @returns {Promise<{ updated: number; items: ActionItem[] }>}
 */
export async function unlinkTicketsFromActionLibrary(links) {
  return apiFetch('/api/actions/unlink-tickets', {
    method: 'POST',
    body: JSON.stringify({ links }),
  })
}
