/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('./feedbackFilterModel.js').FeedbackFilterValues} FeedbackFilterValues */

import { countByField } from './productAnalytics.js'
import { countComplaintCauseL1 } from '../domain/complaintCause.js'
import { EMPTY_FILTER_TOKEN } from './feedbackFilters.js'

/**
 * @param {FeedbackRecord[]} feedbacks
 * @param {string} [product]
 */
export function scopeFeedbacksByProduct(feedbacks, product) {
  if (!product) return feedbacks
  return feedbacks.filter((fb) => (fb.product || '未标注产品') === product)
}

/**
 * @param {{ name: string }[]} options
 * @param {string} value
 */
function optionNamesInclude(options, value) {
  if (!value) return true
  if (value === EMPTY_FILTER_TOKEN) return true
  return options.some((item) => item.name === value)
}

/**
 * 切换产品后清空/校验依赖产品的复合筛选条件。
 *
 * @param {FeedbackFilterValues} filters
 * @param {FeedbackRecord[]} scopedFeedbacks
 */
export function cascadeClearProductDependentFilters(filters, scopedFeedbacks) {
  const next = { ...filters }
  next.journeyL1 = ''
  next.resourcePool = ''

  const problemTypes = countByField(scopedFeedbacks, 'problemType')
  const requestScenes = countByField(scopedFeedbacks, 'requestScene')
  const complaintCauseOptions = countComplaintCauseL1(scopedFeedbacks)

  if (!optionNamesInclude(problemTypes, next.problemType)) {
    next.problemType = ''
  }
  if (!optionNamesInclude(requestScenes, next.requestScene)) {
    next.requestScene = ''
  }
  if (!optionNamesInclude(complaintCauseOptions, next.complaintCauseL1)) {
    next.complaintCauseL1 = ''
  }

  return next
}
