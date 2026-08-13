import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
} from '../domain/actionItem.js'
import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'

/** @typedef {import('./actionItemFilterModel.js').ActionItemFilterKey} ActionItemFilterKey */
/** @typedef {import('./actionItemFilterModel.js').ActionItemFilterValues} ActionItemFilterValues */

/** @typedef {'enum' | 'multiEnum' | 'text'} ActionItemFilterEditorKind */

/** @type {Record<ActionItemFilterKey, ActionItemFilterEditorKind>} */
export const ACTION_ITEM_FILTER_EDITOR_KIND = {
  productKeys: 'multiSearch',
  statuses: 'multiEnum',
  ticketId: 'text',
  linkedDataSources: 'multiEnum',
  problemType: 'enum',
  journeyL1: 'enum',
}

/**
 * @param {ActionItemFilterKey} key
 * @returns {ActionItemFilterEditorKind}
 */
export function getActionItemFilterEditorKind(key) {
  return ACTION_ITEM_FILTER_EDITOR_KIND[key] || 'text'
}

/**
 * @param {ActionItemFilterKey} filterKey
 * @param {ActionItemFilterValues} filters
 */
export function readActionItemFilterDraftValue(filterKey, filters) {
  switch (filterKey) {
    case 'productKeys':
      return [...filters.productKeys]
    case 'statuses':
      return [...filters.statuses]
    case 'linkedDataSources':
      return [...filters.linkedDataSources]
    case 'ticketId':
      return filters.ticketId
    case 'problemType':
      return filters.problemType
    case 'journeyL1':
      return filters.journeyL1
    default:
      return filters[filterKey]
  }
}

/**
 * @param {ActionItemFilterKey} filterKey
 * @param {unknown} draft
 * @returns {Partial<ActionItemFilterValues>}
 */
export function buildActionItemFilterPatchFromDraft(filterKey, draft) {
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
          ? /** @type {import('../domain/actionItem.js').ActionItemStatus[]} */ (
              [...new Set(draft.filter((item) => ACTION_ITEM_STATUSES.includes(item)))]
            )
          : [],
      }
    case 'linkedDataSources':
      return {
        linkedDataSources: Array.isArray(draft)
          ? /** @type {import('../domain/enums.js').DataSourceType[]} */ (
              [...new Set(draft.filter((item) => DATA_SOURCE_TYPES.includes(item)))]
            )
          : [],
      }
    case 'ticketId':
      return { ticketId: String(draft ?? '').trim() }
    case 'problemType':
      return { problemType: String(draft ?? '').trim() }
    case 'journeyL1':
      return { journeyL1: String(draft ?? '').trim() }
    default:
      return { [filterKey]: draft ?? '' }
  }
}

/**
 * @param {ActionItemFilterKey} filterKey
 * @param {unknown} draft
 */
export function isActionItemFilterDraftValid(filterKey, draft) {
  switch (filterKey) {
    case 'productKeys':
    case 'statuses':
    case 'linkedDataSources':
      return Array.isArray(draft) && draft.length > 0
    case 'ticketId':
    case 'problemType':
    case 'journeyL1':
      return Boolean(String(draft ?? '').trim())
    default:
      return Boolean(String(draft ?? '').trim())
  }
}

/**
 * @param {ActionItemFilterKey} filterKey
 * @param {ActionItemFilterValues} _filters
 * @param {{
 *   productOptions?: { label: string; value: string }[]
 *   statusOptions?: { label: string; value: string }[]
 *   problemTypeOptions?: { label: string; value: string }[]
 *   journeyL1Options?: { label: string; value: string }[]
 * }} options
 */
export function listActionItemEnumOptionsForFilterKey(filterKey, _filters, options = {}) {
  switch (filterKey) {
    case 'productKeys':
      return options.productOptions || []
    case 'statuses':
      return (
        options.statusOptions ||
        ACTION_ITEM_STATUSES.map((value) => ({
          label: ACTION_ITEM_STATUS_LABELS[value],
          value,
        }))
      )
    case 'linkedDataSources':
      return DATA_SOURCE_TYPES.map((type) => ({
        label: DATA_SOURCE_LABELS[type],
        value: type,
      }))
    case 'problemType':
      return options.problemTypeOptions || []
    case 'journeyL1':
      return options.journeyL1Options || []
    default:
      return []
  }
}
