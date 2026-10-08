/** 投诉工单手填分类。空值在分布图中归入该标签。 */
export const CUSTOM_PROBLEM_CATEGORY_EMPTY_LABEL = '未填写'

export const CUSTOM_PROBLEM_CATEGORY_MAX_LENGTH = 64

/**
 * @param {unknown} value
 */
export function normalizeCustomProblemCategory(value) {
  return String(value ?? '').trim().slice(0, CUSTOM_PROBLEM_CATEGORY_MAX_LENGTH)
}

/**
 * @param {unknown} value
 */
export function customProblemCategoryLabel(value) {
  return normalizeCustomProblemCategory(value) || CUSTOM_PROBLEM_CATEGORY_EMPTY_LABEL
}
