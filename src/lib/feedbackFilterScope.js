/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('./feedbackFilterModel.js').FeedbackFilterValues} FeedbackFilterValues */
/** @typedef {import('./productCatalogLoader.js').CatalogProduct} CatalogProduct */

import { countByField } from './productAnalytics.js'
import { countComplaintCauseL1 } from '../domain/complaintCause.js'
import {
  FEEDBACK_LANE_CUSTOMER_VISITS,
  FEEDBACK_LANE_POST_USE,
  filterFeedbackRecordsForLane,
} from '../domain/postUseRatingImport.js'
import { EMPTY_FILTER_TOKEN } from './feedbackFilters.js'
import { listProducts } from './productTaxonomy.js'

/**
 * @param {FeedbackRecord[]} feedbacks
 * @param {string} [product]
 */
export function scopeFeedbacksByProduct(feedbacks, product) {
  if (!product) return feedbacks
  return feedbacks.filter((fb) => (fb.product || '未标注产品') === product)
}

/**
 * 反馈库筛选选项所用记录：按当前大类收窄，避免用后即评产品混进工单 Tab。
 * @param {FeedbackRecord[]} records
 * @param {string} lane
 * @returns {FeedbackRecord[]}
 */
export function libraryFilterOptionRecords(records, lane) {
  if (lane === FEEDBACK_LANE_CUSTOMER_VISITS) return []
  const scoped = filterFeedbackRecordsForLane(records, lane)
  if (lane !== FEEDBACK_LANE_POST_USE) return scoped
  return scoped.map((fb) => {
    const product = String(fb.product || fb.productName || '').trim()
    return product && product !== fb.product ? { ...fb, product } : fb
  })
}

/**
 * 反馈库产品下拉：只统计当前大类记录，且只保留「产品与规格」中对应分析开关开启的产品。
 * 工单 Tab 看 enabled；用后即评 Tab 看 analysisPostUseRating。目录为空时回退为记录内产品（避免配置未加载时筛空）。
 *
 * @param {FeedbackRecord[]} records
 * @param {CatalogProduct[] | null | undefined} catalog
 * @param {string} lane
 */
export function listFeedbackLibraryProducts(records, catalog, lane) {
  const listed = listProducts(records)
  if (!Array.isArray(catalog) || catalog.length === 0) return listed
  const allow = new Set(
    catalog
      .filter((product) =>
        lane === FEEDBACK_LANE_POST_USE ? product?.analysisPostUseRating : product?.enabled,
      )
      .map((product) => String(product.name || '').trim())
      .filter(Boolean),
  )
  return listed.filter((item) => allow.has(item.name))
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
