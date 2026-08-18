import {
  TICKET_TODO_RESOLUTION_LABELS,
  TICKET_TODO_RESOLUTIONS,
  TICKET_TODO_SOURCE_TYPES,
} from '../domain/ticketTodo.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'

/** @typedef {import('./ticketTodoFilterModel.js').TicketTodoFilterKey} TicketTodoFilterKey */
/** @typedef {import('./ticketTodoFilterModel.js').TicketTodoFilterValues} TicketTodoFilterValues */

/** @typedef {'enum' | 'multiEnum' | 'multiSearch' | 'text'} TicketTodoFilterEditorKind */

/** @type {Record<TicketTodoFilterKey, TicketTodoFilterEditorKind>} */
export const TICKET_TODO_FILTER_EDITOR_KIND = {
  productKeys: 'multiSearch',
  statuses: 'multiEnum',
  dataSourceTypes: 'multiEnum',
  assigneeUserIds: 'multiEnum',
  ticketId: 'text',
}

/**
 * @param {TicketTodoFilterKey} key
 */
export function getTicketTodoFilterEditorKind(key) {
  return TICKET_TODO_FILTER_EDITOR_KIND[key] || 'text'
}

/**
 * @param {TicketTodoFilterKey} filterKey
 * @param {TicketTodoFilterValues} filters
 */
export function readTicketTodoFilterDraftValue(filterKey, filters) {
  switch (filterKey) {
    case 'productKeys':
      return [...filters.productKeys]
    case 'statuses':
      return [...filters.statuses]
    case 'dataSourceTypes':
      return [...filters.dataSourceTypes]
    case 'assigneeUserIds':
      return [...filters.assigneeUserIds]
    case 'ticketId':
      return filters.ticketId
    default:
      return filters[filterKey]
  }
}

/**
 * @param {TicketTodoFilterKey} filterKey
 * @param {unknown} draft
 * @returns {Partial<TicketTodoFilterValues>}
 */
export function buildTicketTodoFilterPatchFromDraft(filterKey, draft) {
  switch (filterKey) {
    case 'productKeys':
      return {
        productKeys: Array.isArray(draft)
          ? [...new Set(draft.map((item) => String(item).trim()).filter(Boolean))]
          : [],
      }
    case 'statuses':
      return {
        statuses: Array.isArray(draft)
          ? /** @type {import('../domain/ticketTodo.js').TicketTodoResolution[]} */ (
              [...new Set(draft.filter((item) => TICKET_TODO_RESOLUTIONS.includes(item)))]
            )
          : [],
      }
    case 'dataSourceTypes':
      return {
        dataSourceTypes: Array.isArray(draft)
          ? [...new Set(draft.filter((item) =>
              TICKET_TODO_SOURCE_TYPES.includes(/** @type {typeof TICKET_TODO_SOURCE_TYPES[number]} */ (item)),
            ))]
          : [],
      }
    case 'assigneeUserIds':
      return {
        assigneeUserIds: Array.isArray(draft)
          ? [...new Set(draft.map((item) => String(item).trim()).filter(Boolean))]
          : [],
      }
    case 'ticketId':
      return { ticketId: String(draft ?? '').trim() }
    default:
      return {}
  }
}

/**
 * @param {TicketTodoFilterKey} filterKey
 * @param {unknown} draft
 */
export function isTicketTodoFilterDraftValid(filterKey, draft) {
  switch (filterKey) {
    case 'productKeys':
    case 'statuses':
    case 'dataSourceTypes':
    case 'assigneeUserIds':
      return Array.isArray(draft) && draft.length > 0
    case 'ticketId':
      return Boolean(String(draft ?? '').trim())
    default:
      return Boolean(String(draft ?? '').trim())
  }
}

/**
 * @param {TicketTodoFilterKey} filterKey
 * @param {TicketTodoFilterValues} _filters
 * @param {{
 *   productOptions?: { label: string; value: string }[]
 *   statusOptions?: { label: string; value: string }[]
 *   sourceOptions?: { label: string; value: string }[]
 *   assigneeOptions?: { label: string; value: string }[]
 * }} options
 */
export function listTicketTodoEnumOptionsForFilterKey(filterKey, _filters, options = {}) {
  switch (filterKey) {
    case 'productKeys':
      return options.productOptions || []
    case 'statuses':
      return (
        options.statusOptions ||
        TICKET_TODO_RESOLUTIONS.map((value) => ({
          label: TICKET_TODO_RESOLUTION_LABELS[value],
          value,
        }))
      )
    case 'dataSourceTypes':
      return (
        options.sourceOptions ||
        TICKET_TODO_SOURCE_TYPES.map((type) => ({
          label: DATA_SOURCE_LABELS[type],
          value: type,
        }))
      )
    case 'assigneeUserIds':
      return options.assigneeOptions || []
    default:
      return []
  }
}
