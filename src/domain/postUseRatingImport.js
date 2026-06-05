/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

export const POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK = /** @type {const} */ (
  'satisfaction_callback'
)
export const POST_USE_RATING_SUBTYPE_STANDALONE = /** @type {const} */ ('standalone')

/** @typedef {typeof POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK | typeof POST_USE_RATING_SUBTYPE_STANDALONE} PostUseRatingImportSubType */

export const POST_USE_RATING_SUBTYPE_OPTIONS = [
  { value: POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK, label: '满意度回访' },
  { value: POST_USE_RATING_SUBTYPE_STANDALONE, label: '独立评价记录' },
]

/**
 * @param {DataSourceType} dataSourceType
 * @param {PostUseRatingImportSubType} [postUseRatingSubType]
 */
export function isFollowUpSatisfactionImport(dataSourceType, postUseRatingSubType) {
  return (
    dataSourceType === 'post_use_rating' &&
    postUseRatingSubType === POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK
  )
}

/**
 * @param {string | undefined | null} importMonth YYYY-MM
 */
export function periodIdFromImportMonth(importMonth) {
  const s = String(importMonth ?? '').trim()
  return /^\d{4}-\d{2}$/.test(s) ? `period:month:${s}` : ''
}

/**
 * @param {string | undefined | null} importMonth
 * @param {import('./insightPeriod.js').InsightPeriod[]} periods
 */
export function resolvePeriodFromImportMonth(importMonth, periods) {
  const periodId = periodIdFromImportMonth(importMonth)
  if (!periodId) return null
  return periods.find((p) => p.id === periodId) ?? null
}
