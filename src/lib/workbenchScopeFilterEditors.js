import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'

/** @typedef {import('./workbenchScopeFilterModel.js').WorkbenchScopeFilterKey} WorkbenchScopeFilterKey */
/** @typedef {import('./workbenchScopeFilterModel.js').WorkbenchScopeFilterValues} WorkbenchScopeFilterValues */

/** @typedef {'enum'} WorkbenchScopeFilterEditorKind */

/**
 * @param {WorkbenchScopeFilterKey} _key
 * @returns {WorkbenchScopeFilterEditorKind}
 */
export function getWorkbenchScopeFilterEditorKind(_key) {
  return 'enum'
}

/**
 * @param {WorkbenchScopeFilterKey} filterKey
 * @param {WorkbenchScopeFilterValues} filters
 */
export function readWorkbenchScopeFilterDraftValue(filterKey, filters) {
  return filters[filterKey]
}

/**
 * @param {WorkbenchScopeFilterKey} filterKey
 * @param {unknown} draft
 * @returns {Partial<WorkbenchScopeFilterValues>}
 */
export function buildWorkbenchScopeFilterPatchFromDraft(filterKey, draft) {
  return { [filterKey]: String(draft ?? '').trim() }
}

/**
 * @param {WorkbenchScopeFilterKey} _filterKey
 * @param {unknown} draft
 */
export function isWorkbenchScopeFilterDraftValid(_filterKey, draft) {
  return Boolean(String(draft ?? '').trim())
}

/**
 * @param {WorkbenchScopeFilterKey} filterKey
 * @param {WorkbenchScopeFilterValues} filters
 * @param {{
 *   productOptions?: { label: string; value: string }[]
 *   resourcePoolOptions?: { label: string; value: string }[]
 *   complaintCauseOptions?: { label: string; value: string }[]
 * }} options
 */
export function listWorkbenchScopeEnumOptionsForFilterKey(filterKey, filters, options = {}) {
  switch (filterKey) {
    case 'dataSource':
      return DATA_SOURCE_TYPES.map((type) => ({
        label: DATA_SOURCE_LABELS[type],
        value: type,
      }))
    case 'product':
      return options.productOptions || []
    case 'resourcePool':
      return options.resourcePoolOptions || []
    case 'complaintCauseL1':
      return options.complaintCauseOptions || []
    default:
      return []
  }
}
