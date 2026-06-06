import { recordMonth } from './analytics.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

export const UNKNOWN_LINKED_FEEDBACK_MONTH = '未知月份'

/**
 * @typedef {Object} LinkedFeedbackMonthGroup
 * @property {string} month
 * @property {string} label
 * @property {string[]} ticketIds
 */

/**
 * @param {FeedbackRecord[]} feedbacks
 * @returns {Map<string, FeedbackRecord>}
 */
export function buildFeedbackIndexByTicketId(feedbacks) {
  /** @type {Map<string, FeedbackRecord>} */
  const map = new Map()
  for (const record of feedbacks || []) {
    const ticketId = record?.ticketId?.trim()
    if (ticketId && !map.has(ticketId)) map.set(ticketId, record)
  }
  return map
}

/**
 * @param {string} month
 */
export function formatLinkedFeedbackMonthLabel(month) {
  if (!month || month === UNKNOWN_LINKED_FEEDBACK_MONTH) return UNKNOWN_LINKED_FEEDBACK_MONTH
  const match = /^(\d{4})-(\d{1,2})$/.exec(month)
  if (!match) return month
  return `${match[1]}年${Number(match[2])}月`
}

/**
 * @param {string[]} ticketIds
 * @param {Map<string, FeedbackRecord>} [feedbackByTicketId]
 * @returns {LinkedFeedbackMonthGroup[]}
 */
export function groupLinkedTicketIdsByMonth(ticketIds, feedbackByTicketId) {
  const unique = [...new Set((ticketIds || []).map((id) => String(id).trim()).filter(Boolean))]
  /** @type {Map<string, string[]>} */
  const byMonth = new Map()

  for (const ticketId of unique) {
    const record = feedbackByTicketId?.get(ticketId)
    const month = record
      ? recordMonth(record, 'importMonth')
      : UNKNOWN_LINKED_FEEDBACK_MONTH
    if (!byMonth.has(month)) byMonth.set(month, [])
    byMonth.get(month).push(ticketId)
  }

  return [...byMonth.entries()]
    .map(([month, ids]) => ({
      month,
      label: formatLinkedFeedbackMonthLabel(month),
      ticketIds: [...ids].sort((a, b) => a.localeCompare(b, 'zh-CN')),
    }))
    .sort((a, b) => {
      if (a.month === UNKNOWN_LINKED_FEEDBACK_MONTH) return 1
      if (b.month === UNKNOWN_LINKED_FEEDBACK_MONTH) return -1
      return b.month.localeCompare(a.month)
    })
}

/**
 * @param {LinkedFeedbackMonthGroup[]} groups
 */
export function formatLinkedTicketIdsGroupedForExport(groups) {
  return (groups || [])
    .map((group) => `${group.month}: ${group.ticketIds.join('; ')}`)
    .join('\n')
}
