import { apiFetch } from './apiClient.js'
import { toActionItemCreateBody } from '../domain/actionItem.js'
import { toActionItemConflictError } from '../domain/actionItemRevision.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */

/**
 * @typedef {Object} ActionItemListQuery
 * @property {string} [productKey]
 * @property {string} [productKeys]
 * @property {ActionItemStatus} [status]
 * @property {string} [statuses]
 * @property {string} [ticketId]
 * @property {string} [linkedDataSources]
 * @property {string} [problemType]
 * @property {string} [journeyL1]
 * @property {string} [firstProposedFrom]
 * @property {string} [firstProposedTo]
 * @property {string} [insightPeriodId]
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
  if (query.linkedDataSources) params.set('linkedDataSources', query.linkedDataSources)
  if (query.problemType) params.set('problemType', query.problemType)
  if (query.journeyL1) params.set('journeyL1', query.journeyL1)
  if (query.firstProposedFrom) params.set('firstProposedFrom', query.firstProposedFrom)
  if (query.firstProposedTo) params.set('firstProposedTo', query.firstProposedTo)
  if (query.insightPeriodId) params.set('insightPeriodId', query.insightPeriodId)
  if (query.search) params.set('search', query.search)
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const qs = params.toString()
  return apiFetch(`/api/actions${qs ? `?${qs}` : ''}`)
}

/**
 * @typedef {Object} ActionItemProductStatusRow
 * @property {string} productKey
 * @property {string} productName
 * @property {Record<ActionItemStatus, number>} counts
 * @property {Record<ActionItemStatus, number>} [linkedFeedbackCounts]
 * @property {number} total
 * @property {number} [linkedFeedbackTotal]
 */

/**
 * @param {ActionItemListQuery} [query]
 * @returns {Promise<{ counts: Record<ActionItemStatus, number>; byProduct: ActionItemProductStatusRow[] }>}
 */
export async function getActionItemStats(query = {}) {
  const params = new URLSearchParams()
  if (query.productKey) params.set('productKey', query.productKey)
  if (query.productKeys) params.set('productKeys', query.productKeys)
  if (query.status) params.set('status', query.status)
  if (query.statuses) params.set('statuses', query.statuses)
  if (query.ticketId) params.set('ticketId', query.ticketId)
  if (query.linkedDataSources) params.set('linkedDataSources', query.linkedDataSources)
  if (query.problemType) params.set('problemType', query.problemType)
  if (query.journeyL1) params.set('journeyL1', query.journeyL1)
  if (query.firstProposedFrom) params.set('firstProposedFrom', query.firstProposedFrom)
  if (query.firstProposedTo) params.set('firstProposedTo', query.firstProposedTo)
  if (query.insightPeriodId) params.set('insightPeriodId', query.insightPeriodId)
  if (query.search) params.set('search', query.search)
  const qs = params.toString()
  return apiFetch(`/api/actions/stats${qs ? `?${qs}` : ''}`)
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
    body: JSON.stringify(toActionItemCreateBody(input)),
  })
  return data.item
}

/**
 * @param {Partial<ActionItem>[]} items
 * @returns {Promise<{ items: ActionItem[]; errors: { index: number; error: string }[] }>}
 */
export async function createActionItemsBatch(items) {
  return apiFetch('/api/actions/batch', {
    method: 'POST',
    body: JSON.stringify({ items: items.map((item) => toActionItemCreateBody(item)) }),
  })
}

/**
 * @param {string} id
 * @param {Partial<ActionItem>} patch
 * @param {import('../domain/actionItemRevision.js').PutActionItemOptions} [options]
 * @returns {Promise<ActionItem>}
 */
export async function updateActionItem(id, patch, options = {}) {
  const body = { ...patch }
  if (!options.skipConflictCheck && options.expectedRevision != null) {
    body.expectedRevision = options.expectedRevision
  }
  try {
    const data = await apiFetch(`/api/actions/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    })
    return data.item
  } catch (err) {
    const conflict = toActionItemConflictError(err)
    if (conflict) throw conflict
    throw err
  }
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
