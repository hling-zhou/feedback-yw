/**
 * @typedef {Object} PostUseJiraFilterValues
 * @property {string} importMonth
 * @property {string} productName
 * @property {string} status
 * @property {string} search
 */

/** @typedef {keyof PostUseJiraFilterValues} PostUseJiraFilterKey */

/** @type {{ label: string; keys: PostUseJiraFilterKey[] }[]} */
export const POST_USE_JIRA_FILTER_GROUPS = [
  { label: '范围', keys: ['importMonth', 'productName', 'status'] },
  { label: '搜索', keys: ['search'] },
]

/** @type {Record<PostUseJiraFilterKey, string>} */
export const POST_USE_JIRA_FILTER_LABELS = {
  importMonth: '数据月份',
  productName: '产品名称',
  status: '状态',
  search: '客户 / 编码 / JIRA',
}

/** @returns {PostUseJiraFilterValues} */
export function createEmptyPostUseJiraFilters() {
  return {
    importMonth: '',
    productName: '',
    status: '',
    search: '',
  }
}

/**
 * @param {PostUseJiraFilterValues} values
 * @param {PostUseJiraFilterKey} key
 */
export function isPostUseJiraFilterActive(values, key) {
  return Boolean(String(values[key] ?? '').trim())
}

/**
 * @param {PostUseJiraFilterValues} values
 * @returns {PostUseJiraFilterKey[]}
 */
export function listActivePostUseJiraFilterChipKeys(values) {
  /** @type {PostUseJiraFilterKey[]} */
  const keys = []
  if (isPostUseJiraFilterActive(values, 'importMonth')) keys.push('importMonth')
  if (isPostUseJiraFilterActive(values, 'productName')) keys.push('productName')
  if (isPostUseJiraFilterActive(values, 'status')) keys.push('status')
  if (isPostUseJiraFilterActive(values, 'search')) keys.push('search')
  return keys
}

/**
 * @param {PostUseJiraFilterValues} values
 */
export function countActivePostUseJiraFilters(values) {
  return listActivePostUseJiraFilterChipKeys(values).length
}

/**
 * @param {PostUseJiraFilterKey} key
 * @param {PostUseJiraFilterValues} values
 */
export function formatPostUseJiraFilterChipLabel(key, values) {
  return String(values[key] ?? '').trim()
}

/**
 * @param {PostUseJiraFilterKey} key
 * @param {PostUseJiraFilterValues} values
 */
export function isPostUseJiraFilterAddDisabled(key, values) {
  return isPostUseJiraFilterActive(values, key)
}

/**
 * @param {PostUseJiraFilterKey} key
 * @param {PostUseJiraFilterValues} values
 * @returns {string | undefined}
 */
export function getPostUseJiraFilterAddDisabledReason(key, values) {
  if (isPostUseJiraFilterActive(values, key)) return '已添加该筛选条件'
  return undefined
}

/**
 * @param {PostUseJiraFilterKey} key
 */
export function normalizePostUseJiraFilterEditorKey(key) {
  return key
}

/**
 * @param {PostUseJiraFilterKey} key
 * @param {Partial<PostUseJiraFilterValues>} patch
 * @param {PostUseJiraFilterValues} current
 * @returns {PostUseJiraFilterValues}
 */
export function applyPostUseJiraFilterPatch(key, patch, current) {
  return { ...current, ...patch }
}

/**
 * @param {PostUseJiraFilterKey} key
 * @param {PostUseJiraFilterValues} current
 * @returns {PostUseJiraFilterValues}
 */
export function clearPostUseJiraFilterKey(key, current) {
  return applyPostUseJiraFilterPatch(key, { [key]: '' }, current)
}

/** @returns {PostUseJiraFilterValues} */
export function clearAllPostUseJiraFilters() {
  return createEmptyPostUseJiraFilters()
}

/**
 * @param {PostUseJiraFilterValues} filters
 */
export function postUseJiraFiltersToListQuery(filters) {
  return {
    importMonth: filters.importMonth.trim() || undefined,
    productName: filters.productName.trim() || undefined,
    status: filters.status.trim() || undefined,
    search: filters.search.trim() || undefined,
  }
}
