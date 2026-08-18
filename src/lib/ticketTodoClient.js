import { apiFetch } from './apiClient.js'

/** @typedef {import('../domain/ticketTodo.js').TicketTodoRow} TicketTodoRow */
/** @typedef {import('../domain/ticketTodo.js').TicketTodoResolution} TicketTodoResolution */

/**
 * @typedef {Object} TicketTodoListQuery
 * @property {string} [productKey]
 * @property {string} [productKeys]
 * @property {TicketTodoResolution} [status]
 * @property {string} [statuses]
 * @property {string} [dataSourceType]
 * @property {string} [dataSourceTypes]
 * @property {string} [assigneeUserId]
 * @property {string} [assigneeUserIds]
 * @property {string} [ticketId]
 * @property {string} [insightPeriodId]
 * @property {string} [search]
 * @property {number} [limit]
 * @property {number} [offset]
 */

/**
 * @param {TicketTodoListQuery} [query]
 */
function toQueryString(query = {}) {
  const params = new URLSearchParams()
  if (query.productKey) params.set('productKey', query.productKey)
  if (query.productKeys) params.set('productKeys', query.productKeys)
  if (query.status) params.set('status', query.status)
  if (query.statuses) params.set('statuses', query.statuses)
  if (query.dataSourceType) params.set('dataSourceType', query.dataSourceType)
  if (query.dataSourceTypes) params.set('dataSourceTypes', query.dataSourceTypes)
  if (query.assigneeUserId) params.set('assigneeUserId', query.assigneeUserId)
  if (query.assigneeUserIds) params.set('assigneeUserIds', query.assigneeUserIds)
  if (query.ticketId) params.set('ticketId', query.ticketId)
  if (query.insightPeriodId) params.set('insightPeriodId', query.insightPeriodId)
  if (query.search) params.set('search', query.search)
  if (query.limit != null) params.set('limit', String(query.limit))
  if (query.offset != null) params.set('offset', String(query.offset))
  const qs = params.toString()
  return qs ? `?${qs}` : ''
}

/**
 * @param {TicketTodoListQuery} [query]
 * @returns {Promise<{ items: TicketTodoRow[]; total: number; limit: number; offset: number }>}
 */
export async function listTicketTodos(query = {}) {
  return apiFetch(`/api/ticket-todos${toQueryString(query)}`)
}

/**
 * @typedef {Object} TicketTodoProductStatusRow
 * @property {string} productKey
 * @property {string} productName
 * @property {Record<TicketTodoResolution, number>} counts
 * @property {number} total
 * @property {number} rate
 */

/**
 * @param {TicketTodoListQuery} [query]
 * @returns {Promise<{
 *   counts: Record<TicketTodoResolution, number>
 *   total: number
 *   conversionRate: number
 *   byProduct: TicketTodoProductStatusRow[]
 *   facets?: {
 *     products: { productKey: string; productName: string }[]
 *     assignees: { userId: string; username: string }[]
 *     hasUnassigned: boolean
 *   }
 * }>}
 */
export async function getTicketTodoStats(query = {}) {
  return apiFetch(`/api/ticket-todos/stats${toQueryString(query)}`)
}
