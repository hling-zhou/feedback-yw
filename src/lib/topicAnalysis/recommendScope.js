import { extractValidCustomerTexts } from '../postUseRating/customerQuotes.js'
import { recordSourceType } from '../../snapshots/recordScope.js'

/**
 * @param {object} record
 */
export function postUseHasNegativeFeedback(record) {
  return extractValidCustomerTexts(record).some((item) => item.polarity === 'negative')
}

/**
 * 推荐专题：丢掉用后即评「10 分且无负面反馈」的记录。投诉/咨询一律保留。
 * @param {object} record
 */
export function keepRecordForTopicRecommend(record) {
  if (recordSourceType(record) !== 'post_use_rating') return true
  const score = Number(record?.ratingScore ?? record?.score)
  if (score !== 10) return true
  return postUseHasNegativeFeedback(record)
}

/**
 * @param {object[] | null | undefined} records
 */
export function filterRecordsForTopicRecommend(records) {
  return (records || []).filter(keepRecordForTopicRecommend)
}
