/** @typedef {'manual' | 'save'} UserTicketReviewSource */

/**
 * @typedef {Object} UserTicketReviewItem
 * @property {string} recordId
 * @property {UserTicketReviewSource} source
 * @property {string} markedAt
 */

/** @typedef {'' | 'done' | 'pending'} MyReviewFilterValue */

export const MY_REVIEW_FILTER_OPTIONS = [
  { label: '全部', value: '' },
  { label: '已处理', value: 'done' },
  { label: '未处理', value: 'pending' },
]

const MY_REVIEW_FILTER_VALUES = new Set(['done', 'pending'])

/**
 * @param {string | null | undefined} raw
 * @returns {MyReviewFilterValue}
 */
export function parseMyReviewFilterParam(raw) {
  const value = raw?.trim()
  if (!value) return ''
  return MY_REVIEW_FILTER_VALUES.has(value) ? /** @type {MyReviewFilterValue} */ (value) : ''
}

/**
 * @param {MyReviewFilterValue | string} filter
 * @param {string} recordId
 * @param {ReadonlySet<string> | Record<string, unknown>} doneSetOrMap
 */
export function matchesMyReviewFilter(filter, recordId, doneSetOrMap) {
  if (!filter) return true
  const done =
    doneSetOrMap instanceof Set
      ? doneSetOrMap.has(recordId)
      : Boolean(doneSetOrMap[recordId])
  if (filter === 'done') return done
  if (filter === 'pending') return !done
  return true
}
