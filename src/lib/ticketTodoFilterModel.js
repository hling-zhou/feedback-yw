import {
  TICKET_TODO_RESOLUTION_LABELS,
  TICKET_TODO_RESOLUTIONS,
  TICKET_TODO_UNASSIGNED_ASSIGNEE,
} from '../domain/ticketTodo.js'
import { DATA_SOURCE_LABELS } from '../domain/enums.js'

/** @typedef {import('../domain/ticketTodo.js').TicketTodoResolution} TicketTodoResolution */

/**
 * @typedef {Object} TicketTodoFilterValues
 * @property {string[]} productKeys
 * @property {TicketTodoResolution[]} statuses
 * @property {string[]} dataSourceTypes
 * @property {string[]} assigneeUserIds
 * @property {string} ticketId
 */

/** @typedef {keyof TicketTodoFilterValues} TicketTodoFilterKey */

/** @type {{ label: string; keys: TicketTodoFilterKey[] }[]} */
export const TICKET_TODO_FILTER_GROUPS = [
  { label: '待办', keys: ['productKeys', 'statuses', 'assigneeUserIds'] },
  { label: '关联', keys: ['ticketId', 'dataSourceTypes'] },
]

/** @type {Record<TicketTodoFilterKey, string>} */
export const TICKET_TODO_FILTER_LABELS = {
  productKeys: '产品',
  statuses: '状态',
  dataSourceTypes: '来源',
  assigneeUserIds: '负责人',
  ticketId: '关联工单号',
}

/** @returns {TicketTodoFilterValues} */
export function createEmptyTicketTodoFilters() {
  return {
    productKeys: [],
    statuses: [],
    dataSourceTypes: [],
    assigneeUserIds: [],
    ticketId: '',
  }
}

/**
 * @param {TicketTodoFilterValues} values
 * @param {TicketTodoFilterKey} key
 */
export function isTicketTodoFilterActive(values, key) {
  switch (key) {
    case 'productKeys':
      return values.productKeys.length > 0
    case 'statuses':
      return values.statuses.length > 0
    case 'dataSourceTypes':
      return values.dataSourceTypes.length > 0
    case 'assigneeUserIds':
      return values.assigneeUserIds.length > 0
    case 'ticketId':
      return Boolean(values.ticketId.trim())
    default:
      return false
  }
}

/**
 * @param {TicketTodoFilterValues} values
 */
export function listActiveTicketTodoFilterChipKeys(values) {
  /** @type {TicketTodoFilterKey[]} */
  const keys = []
  if (isTicketTodoFilterActive(values, 'productKeys')) keys.push('productKeys')
  if (isTicketTodoFilterActive(values, 'statuses')) keys.push('statuses')
  if (isTicketTodoFilterActive(values, 'dataSourceTypes')) keys.push('dataSourceTypes')
  if (isTicketTodoFilterActive(values, 'assigneeUserIds')) keys.push('assigneeUserIds')
  if (isTicketTodoFilterActive(values, 'ticketId')) keys.push('ticketId')
  return keys
}

/**
 * @param {TicketTodoFilterValues} values
 */
export function countActiveTicketTodoFilters(values) {
  return listActiveTicketTodoFilterChipKeys(values).length
}

/**
 * @param {TicketTodoFilterKey} key
 * @param {TicketTodoFilterValues} values
 * @param {{ productNameByKey?: Map<string, string>; assigneeNameById?: Map<string, string> }} [ctx]
 */
export function formatTicketTodoFilterChipLabel(key, values, ctx = {}) {
  const nameByKey = ctx.productNameByKey || new Map()
  const assigneeNameById = ctx.assigneeNameById || new Map()
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
        return TICKET_TODO_RESOLUTION_LABELS[values.statuses[0]] || values.statuses[0]
      }
      return `${values.statuses.length} 个`
    }
    case 'dataSourceTypes': {
      if (values.dataSourceTypes.length === 1) {
        const source = values.dataSourceTypes[0]
        return DATA_SOURCE_LABELS[source] || source
      }
      return `${values.dataSourceTypes.length} 个`
    }
    case 'assigneeUserIds': {
      if (values.assigneeUserIds.length === 1) {
        const id = values.assigneeUserIds[0]
        if (id === TICKET_TODO_UNASSIGNED_ASSIGNEE) return '未指定'
        return assigneeNameById.get(id) || id
      }
      return `${values.assigneeUserIds.length} 个`
    }
    case 'ticketId':
      return values.ticketId.trim()
    default:
      return ''
  }
}

/**
 * @param {TicketTodoFilterKey} key
 * @param {TicketTodoFilterValues} values
 */
export function isTicketTodoFilterAddDisabled(key, values) {
  return isTicketTodoFilterActive(values, key)
}

/**
 * @param {TicketTodoFilterKey} key
 * @param {TicketTodoFilterValues} values
 */
export function getTicketTodoFilterAddDisabledReason(key, values) {
  if (isTicketTodoFilterActive(values, key)) return '已添加该筛选条件'
  return undefined
}

/**
 * @param {TicketTodoFilterKey} key
 */
export function normalizeTicketTodoFilterEditorKey(key) {
  return key
}

/**
 * @param {TicketTodoFilterKey} key
 * @param {Partial<TicketTodoFilterValues>} patch
 * @param {TicketTodoFilterValues} current
 */
export function applyTicketTodoFilterPatch(key, patch, current) {
  return { ...current, ...patch }
}

/**
 * @param {TicketTodoFilterKey} key
 * @param {TicketTodoFilterValues} current
 */
export function clearTicketTodoFilterKey(key, current) {
  /** @type {Partial<TicketTodoFilterValues>} */
  const patch = {}
  switch (key) {
    case 'productKeys':
      patch.productKeys = []
      break
    case 'statuses':
      patch.statuses = []
      break
    case 'dataSourceTypes':
      patch.dataSourceTypes = []
      break
    case 'assigneeUserIds':
      patch.assigneeUserIds = []
      break
    case 'ticketId':
      patch.ticketId = ''
      break
    default:
      break
  }
  return applyTicketTodoFilterPatch(key, patch, current)
}

export function clearAllTicketTodoFilters() {
  return createEmptyTicketTodoFilters()
}

/**
 * @param {TicketTodoFilterValues} filters
 */
export function ticketTodoFiltersToListQuery(filters) {
  return {
    productKeys: filters.productKeys.length ? filters.productKeys.join(',') : undefined,
    statuses: filters.statuses.length ? filters.statuses.join(',') : undefined,
    dataSourceTypes: filters.dataSourceTypes.length
      ? filters.dataSourceTypes.join(',')
      : undefined,
    assigneeUserIds: filters.assigneeUserIds.length
      ? filters.assigneeUserIds.join(',')
      : undefined,
    ticketId: filters.ticketId.trim() || undefined,
  }
}

/**
 * @param {import('../domain/ticketTodo.js').TicketTodoRow[]} rows
 */
export function buildTicketTodoProductFilterOptions(rows) {
  /** @type {Map<string, { label: string; value: string }>} */
  const map = new Map()
  for (const row of rows || []) {
    const value = row.productKey?.trim() || '_unknown'
    if (map.has(value)) continue
    map.set(value, { value, label: row.productName?.trim() || value })
  }
  return [...map.values()]
}

/**
 * @param {import('../domain/ticketTodo.js').TicketTodoRow[]} rows
 */
export function buildTicketTodoAssigneeFilterOptions(rows) {
  /** @type {Map<string, { label: string; value: string }>} */
  const map = new Map()
  let hasUnassigned = false
  for (const row of rows || []) {
    const id = row.assigneeUserId?.trim()
    if (!id) {
      hasUnassigned = true
      continue
    }
    if (!map.has(id)) {
      map.set(id, { value: id, label: row.assigneeUsername?.trim() || id })
    }
  }
  const options = [...map.values()].sort((a, b) => a.label.localeCompare(b.label, 'zh-CN'))
  if (hasUnassigned) {
    options.unshift({ value: TICKET_TODO_UNASSIGNED_ASSIGNEE, label: '未指定' })
  }
  return options
}
