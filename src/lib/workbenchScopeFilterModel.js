import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'

/** @typedef {'dataSource' | 'product' | 'resourcePool' | 'complaintCauseL1'} WorkbenchScopeFilterKey */

/**
 * @typedef {Object} WorkbenchScopeFilterValues
 * @property {string} dataSource
 * @property {string} product
 * @property {string} resourcePool
 * @property {string} complaintCauseL1
 */

/** @type {Record<WorkbenchScopeFilterKey, string>} */
export const WORKBENCH_SCOPE_FILTER_LABELS = {
  dataSource: '数据来源',
  product: '产品',
  resourcePool: '资源池',
  complaintCauseL1: '投诉原因（终判）',
}

/** @type {{ label: string; keys: WorkbenchScopeFilterKey[] }[]} */
export const WORKBENCH_ANALYSIS_SCOPE_GROUPS = [
  { label: '数据', keys: ['dataSource'] },
  { label: '打标', keys: ['product', 'resourcePool'] },
]

/** @type {{ label: string; keys: WorkbenchScopeFilterKey[] }[]} */
export const WORKBENCH_TICKET_SCOPE_GROUPS = [
  { label: '打标', keys: ['product', 'complaintCauseL1', 'resourcePool'] },
]

/** @type {WorkbenchScopeFilterKey[]} */
export const WORKBENCH_ANALYSIS_SCOPE_KEYS = ['dataSource', 'product', 'resourcePool']

/** @type {WorkbenchScopeFilterKey[]} */
export const WORKBENCH_TICKET_SCOPE_KEYS = ['product', 'complaintCauseL1', 'resourcePool']

/** @returns {WorkbenchScopeFilterValues} */
export function createEmptyWorkbenchScopeFilters() {
  return {
    dataSource: '',
    product: '',
    resourcePool: '',
    complaintCauseL1: '',
  }
}

/**
 * @param {WorkbenchScopeFilterValues} values
 * @param {WorkbenchScopeFilterKey} key
 */
export function isWorkbenchScopeFilterActive(values, key) {
  return Boolean(String(values[key] ?? '').trim())
}

/**
 * @param {WorkbenchScopeFilterValues} values
 * @param {WorkbenchScopeFilterKey[]} activeKeys
 */
export function listActiveWorkbenchScopeFilterChipKeys(values, activeKeys) {
  return activeKeys.filter((key) => isWorkbenchScopeFilterActive(values, key))
}

/**
 * @param {WorkbenchScopeFilterValues} values
 * @param {WorkbenchScopeFilterKey[]} activeKeys
 */
export function countActiveWorkbenchScopeFilters(values, activeKeys) {
  return listActiveWorkbenchScopeFilterChipKeys(values, activeKeys).length
}

/**
 * @param {WorkbenchScopeFilterKey} key
 * @param {WorkbenchScopeFilterValues} values
 */
export function formatWorkbenchScopeFilterChipLabel(key, values) {
  switch (key) {
    case 'dataSource':
      return DATA_SOURCE_LABELS[values.dataSource] || values.dataSource
    default:
      return String(values[key] ?? '')
  }
}

/**
 * @param {WorkbenchScopeFilterKey} key
 * @param {WorkbenchScopeFilterValues} values
 * @param {{ showComplaintCause?: boolean; hasProduct?: boolean; enabledKeys?: WorkbenchScopeFilterKey[] }} [ctx]
 */
export function isWorkbenchScopeFilterAddDisabled(key, values, ctx = {}) {
  if (isWorkbenchScopeFilterActive(values, key)) return true
  if (ctx.enabledKeys && !ctx.enabledKeys.includes(key)) return true
  if (key === 'complaintCauseL1' && ctx.showComplaintCause === false) return true
  return false
}

/**
 * @param {WorkbenchScopeFilterKey} key
 * @param {WorkbenchScopeFilterValues} values
 * @param {{ showComplaintCause?: boolean; enabledKeys?: WorkbenchScopeFilterKey[] }} [ctx]
 * @returns {string | undefined}
 */
export function getWorkbenchScopeFilterAddDisabledReason(key, values, ctx = {}) {
  if (isWorkbenchScopeFilterActive(values, key)) return '已添加该筛选条件'
  if (ctx.enabledKeys && !ctx.enabledKeys.includes(key)) return '当前页面不支持该筛选'
  if (key === 'complaintCauseL1' && ctx.showComplaintCause === false) {
    return '仅投诉工单支持投诉原因（终判）'
  }
  return undefined
}

/**
 * @param {WorkbenchScopeFilterKey} key
 */
export function normalizeWorkbenchScopeFilterEditorKey(key) {
  return key
}

/**
 * @param {WorkbenchScopeFilterKey} key
 * @param {Partial<WorkbenchScopeFilterValues>} patch
 * @param {WorkbenchScopeFilterValues} current
 * @returns {WorkbenchScopeFilterValues}
 */
export function applyWorkbenchScopeFilterPatch(key, patch, current) {
  const next = { ...current, ...patch }
  if (key === 'dataSource' && 'dataSource' in patch) {
    next.product = ''
    next.resourcePool = ''
    next.complaintCauseL1 = ''
  }
  if (key === 'product' && 'product' in patch) {
    next.resourcePool = ''
    next.complaintCauseL1 = ''
  }
  if (key === 'complaintCauseL1' && 'complaintCauseL1' in patch) {
    /* journey drill-down cleared by caller */
  }
  if (key === 'resourcePool' && 'resourcePool' in patch) {
    /* journey drill-down cleared by caller */
  }
  return next
}

/**
 * @param {WorkbenchScopeFilterKey} key
 * @param {WorkbenchScopeFilterValues} current
 * @param {WorkbenchScopeFilterKey[]} [enabledKeys]
 * @returns {WorkbenchScopeFilterValues}
 */
export function clearWorkbenchScopeFilterKey(key, current, enabledKeys) {
  /** @type {Partial<WorkbenchScopeFilterValues>} */
  const patch = { [key]: '' }
  const next = applyWorkbenchScopeFilterPatch(key, patch, current)
  if (!enabledKeys?.length) return next
  return {
    ...createEmptyWorkbenchScopeFilters(),
    ...Object.fromEntries(enabledKeys.map((k) => [k, next[k]])),
  }
}

/**
 * @param {WorkbenchScopeFilterKey[]} enabledKeys
 * @returns {WorkbenchScopeFilterValues}
 */
export function clearAllWorkbenchScopeFilters(enabledKeys) {
  const empty = createEmptyWorkbenchScopeFilters()
  if (!enabledKeys?.length) return empty
  return {
    ...empty,
    ...Object.fromEntries(enabledKeys.map((key) => [key, ''])),
  }
}

/**
 * @param {WorkbenchScopeFilterValues} values
 * @param {WorkbenchScopeFilterKey[]} enabledKeys
 */
export function pickWorkbenchScopeFilters(values, enabledKeys) {
  /** @type {WorkbenchScopeFilterValues} */
  const picked = createEmptyWorkbenchScopeFilters()
  for (const key of enabledKeys) {
    picked[key] = values[key] || ''
  }
  return picked
}

/**
 * @param {Partial<Pick<WorkbenchScopeFilterValues, 'dataSource' | 'product'>>} parsed
 * @returns {WorkbenchScopeFilterValues}
 */
export function workbenchScopeFiltersFromAnalysisParams(parsed) {
  return {
    ...createEmptyWorkbenchScopeFilters(),
    dataSource: parsed.source || '',
    product: parsed.product || '',
  }
}

export { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS }
