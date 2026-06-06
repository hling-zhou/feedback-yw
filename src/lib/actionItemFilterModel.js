import {
  ACTION_ITEM_STATUSES,
  ACTION_ITEM_STATUS_LABELS,
} from '../domain/actionItem.js'

/** @typedef {import('../domain/actionItem.js').ActionItemStatus} ActionItemStatus */

/**
 * @typedef {Object} ActionItemFilterValues
 * @property {string[]} productKeys
 * @property {ActionItemStatus[]} statuses
 * @property {string} ticketId
 */

/** @typedef {keyof ActionItemFilterValues} ActionItemFilterKey */

/** @type {{ label: string; keys: ActionItemFilterKey[] }[]} */
export const ACTION_ITEM_FILTER_GROUPS = [
  { label: '关联', keys: ['ticketId'] },
  { label: '举措', keys: ['productKeys', 'statuses'] },
]

/** @type {Record<ActionItemFilterKey, string>} */
export const ACTION_ITEM_FILTER_LABELS = {
  productKeys: '产品',
  statuses: '状态',
  ticketId: '关联反馈号',
}

/** @returns {ActionItemFilterValues} */
export function createEmptyActionItemFilters() {
  return {
    productKeys: [],
    statuses: [],
    ticketId: '',
  }
}

/**
 * @param {ActionItemFilterValues} values
 * @param {ActionItemFilterKey} key
 */
export function isActionItemFilterActive(values, key) {
  switch (key) {
    case 'productKeys':
      return values.productKeys.length > 0
    case 'statuses':
      return values.statuses.length > 0
    case 'ticketId':
      return Boolean(values.ticketId.trim())
    default:
      return false
  }
}

/**
 * @param {ActionItemFilterValues} values
 * @returns {ActionItemFilterKey[]}
 */
export function listActiveActionItemFilterChipKeys(values) {
  /** @type {ActionItemFilterKey[]} */
  const keys = []
  if (isActionItemFilterActive(values, 'ticketId')) keys.push('ticketId')
  if (isActionItemFilterActive(values, 'productKeys')) keys.push('productKeys')
  if (isActionItemFilterActive(values, 'statuses')) keys.push('statuses')
  return keys
}

/**
 * @param {ActionItemFilterValues} values
 */
export function countActiveActionItemFilters(values) {
  return listActiveActionItemFilterChipKeys(values).length
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} values
 * @param {{ productNameByKey?: Map<string, string> }} [ctx]
 */
export function formatActionItemFilterChipLabel(key, values, ctx = {}) {
  const nameByKey = ctx.productNameByKey || new Map()
  switch (key) {
    case 'productKeys': {
      if (values.productKeys.length === 1) {
        const pk = values.productKeys[0]
        return nameByKey.get(pk) || pk
      }
      return `${values.productKeys.length} 个`
    }
    case 'statuses': {
      if (values.statuses.length === 1) {
        return ACTION_ITEM_STATUS_LABELS[values.statuses[0]] || values.statuses[0]
      }
      return `${values.statuses.length} 个`
    }
    case 'ticketId':
      return values.ticketId.trim()
    default:
      return ''
  }
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} values
 */
export function isActionItemFilterAddDisabled(key, values) {
  return isActionItemFilterActive(values, key)
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} values
 * @returns {string | undefined}
 */
export function getActionItemFilterAddDisabledReason(key, values) {
  if (isActionItemFilterActive(values, key)) return '已添加该筛选条件'
  return undefined
}

/**
 * @param {ActionItemFilterKey} key
 */
export function normalizeActionItemFilterEditorKey(key) {
  return key
}

/**
 * @param {ActionItemFilterKey} key
 * @param {Partial<ActionItemFilterValues>} patch
 * @param {ActionItemFilterValues} current
 * @returns {ActionItemFilterValues}
 */
export function applyActionItemFilterPatch(key, patch, current) {
  return { ...current, ...patch }
}

/**
 * @param {ActionItemFilterKey} key
 * @param {ActionItemFilterValues} current
 * @returns {ActionItemFilterValues}
 */
export function clearActionItemFilterKey(key, current) {
  /** @type {Partial<ActionItemFilterValues>} */
  const patch = {}
  switch (key) {
    case 'productKeys':
      patch.productKeys = []
      break
    case 'statuses':
      patch.statuses = []
      break
    case 'ticketId':
      patch.ticketId = ''
      break
    default:
      break
  }
  return applyActionItemFilterPatch(key, patch, current)
}

/** @returns {ActionItemFilterValues} */
export function clearAllActionItemFilters() {
  return createEmptyActionItemFilters()
}

/**
 * @param {ActionItemFilterValues} filters
 * @returns {{ productKeys?: string; statuses?: string; ticketId?: string }}
 */
export function actionItemFiltersToListQuery(filters) {
  return {
    productKeys: filters.productKeys.length ? filters.productKeys.join(',') : undefined,
    statuses: filters.statuses.length ? filters.statuses.join(',') : undefined,
    ticketId: filters.ticketId.trim() || undefined,
  }
}
