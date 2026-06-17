/** @typedef {import('./actionItem.js').ActionItem} ActionItem */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * @typedef {Pick<FeedbackRecord, 'problemType' | 'journeyL1' | 'journeyL2'>} ActionItemFeedbackLookup
 */

/**
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 * @param {string} ticketId
 */
function lookupFeedback(feedbackByTicketId, ticketId) {
  if (!feedbackByTicketId || !ticketId) return null
  return feedbackByTicketId.get(ticketId) ?? null
}

/**
 * 举措列表「问题类型」展示/筛选：优先快照，空则首单关联工单回退。
 *
 * @param {ActionItem} item
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function resolveProblemTypeDisplay(item, feedbackByTicketId) {
  const snapshot = String(item.problemTypeSnapshot ?? '').trim()
  if (snapshot) return snapshot
  const firstId = item.linkedTicketIds?.[0]?.trim()
  if (!firstId) return ''
  const record = lookupFeedback(feedbackByTicketId, firstId)
  return String(record?.problemType ?? '').trim()
}

/**
 * 举措列表「用户旅程」展示/筛选：优先快照，空则首单关联工单回退。
 *
 * @param {ActionItem} item
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function resolveJourneyDisplay(item, feedbackByTicketId) {
  const l1 = String(item.journeyL1Snapshot ?? '').trim()
  const l2 = String(item.journeyL2Snapshot ?? '').trim()
  if (l1 || l2) {
    return { journeyL1: l1, journeyL2: l2 }
  }
  const firstId = item.linkedTicketIds?.[0]?.trim()
  if (!firstId) return { journeyL1: '', journeyL2: '' }
  const record = lookupFeedback(feedbackByTicketId, firstId)
  return {
    journeyL1: String(record?.journeyL1 ?? '').trim(),
    journeyL2: String(record?.journeyL2 ?? '').trim(),
  }
}

/**
 * @param {ActionItem} item
 * @param {string} problemType
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function actionItemMatchesProblemTypeFilter(item, problemType, feedbackByTicketId) {
  const needle = String(problemType ?? '').trim()
  if (!needle) return true
  return resolveProblemTypeDisplay(item, feedbackByTicketId) === needle
}

/**
 * @param {ActionItem} item
 * @param {string} journeyL1
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function actionItemMatchesJourneyL1Filter(item, journeyL1, feedbackByTicketId) {
  const needle = String(journeyL1 ?? '').trim()
  if (!needle) return true
  return resolveJourneyDisplay(item, feedbackByTicketId).journeyL1 === needle
}

/**
 * @param {ActionItem[]} items
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function buildActionItemProblemTypeFilterOptions(items, feedbackByTicketId) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const item of items) {
    const value = resolveProblemTypeDisplay(item, feedbackByTicketId)
    if (!value) continue
    counts.set(value, (counts.get(value) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([name]) => ({ label: name, value: name }))
}

/**
 * @param {ActionItem[]} items
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function buildActionItemJourneyL1FilterOptions(items, feedbackByTicketId) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const item of items) {
    const { journeyL1 } = resolveJourneyDisplay(item, feedbackByTicketId)
    if (!journeyL1) continue
    counts.set(journeyL1, (counts.get(journeyL1) || 0) + 1)
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([name]) => ({ label: name, value: name }))
}
