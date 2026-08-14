import { POST_USE_JIRA_STATUSES } from '../domain/postUseJira.js'

/** @typedef {import('./postUseJiraFilterModel.js').PostUseJiraFilterKey} PostUseJiraFilterKey */
/** @typedef {import('./postUseJiraFilterModel.js').PostUseJiraFilterValues} PostUseJiraFilterValues */

/** @typedef {'enum' | 'text'} PostUseJiraFilterEditorKind */

/** @type {Record<PostUseJiraFilterKey, PostUseJiraFilterEditorKind>} */
export const POST_USE_JIRA_FILTER_EDITOR_KIND = {
  importMonth: 'text',
  productName: 'text',
  status: 'enum',
  search: 'text',
}

/**
 * @param {PostUseJiraFilterKey} key
 * @returns {PostUseJiraFilterEditorKind}
 */
export function getPostUseJiraFilterEditorKind(key) {
  return POST_USE_JIRA_FILTER_EDITOR_KIND[key] || 'text'
}

/**
 * @param {PostUseJiraFilterKey} filterKey
 * @param {PostUseJiraFilterValues} filters
 */
export function readPostUseJiraFilterDraftValue(filterKey, filters) {
  return filters[filterKey]
}

/**
 * @param {PostUseJiraFilterKey} filterKey
 * @param {unknown} draft
 * @returns {Partial<PostUseJiraFilterValues>}
 */
export function buildPostUseJiraFilterPatchFromDraft(filterKey, draft) {
  return { [filterKey]: String(draft ?? '').trim() }
}

/**
 * @param {PostUseJiraFilterKey} filterKey
 * @param {unknown} draft
 */
export function isPostUseJiraFilterDraftValid(filterKey, draft) {
  return Boolean(String(draft ?? '').trim())
}

/**
 * @param {PostUseJiraFilterKey} filterKey
 * @param {PostUseJiraFilterValues} _filters
 * @param {{ statusOptions?: { label: string; value: string }[] }} [options]
 */
export function listPostUseJiraEnumOptionsForFilterKey(filterKey, _filters, options = {}) {
  if (filterKey !== 'status') return []
  return (
    options.statusOptions ||
    POST_USE_JIRA_STATUSES.map((value) => ({ label: value, value }))
  )
}
