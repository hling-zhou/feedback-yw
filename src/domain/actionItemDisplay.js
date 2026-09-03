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
 * 遍历举措所有关联工单收集 problemType（去重）。
 *
 * @param {ActionItem} item
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 * @returns {string[]}
 */
export function collectProblemTypesFromItem(item, feedbackByTicketId) {
  const ids = (item?.linkedTicketIds || []).map((id) => String(id).trim()).filter(Boolean)
  const seen = new Set()
  for (const ticketId of ids) {
    const record = lookupFeedback(feedbackByTicketId, ticketId)
    const value = String(record?.problemType ?? '').trim()
    if (value) seen.add(value)
  }
  // 兜底：无关联工单时回退快照
  if (!seen.size) {
    const snapshot = String(item?.problemTypeSnapshot ?? '').trim()
    if (snapshot) seen.add(snapshot)
  }
  return [...seen]
}

/**
 * 遍历举措所有关联工单收集 journeyL1（去重）。
 *
 * @param {ActionItem} item
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 * @returns {string[]}
 */
export function collectJourneyL1FromItem(item, feedbackByTicketId) {
  const ids = (item?.linkedTicketIds || []).map((id) => String(id).trim()).filter(Boolean)
  const seen = new Set()
  for (const ticketId of ids) {
    const record = lookupFeedback(feedbackByTicketId, ticketId)
    const value = String(record?.journeyL1 ?? '').trim()
    if (value) seen.add(value)
  }
  if (!seen.size) {
    const snapshot = String(item?.journeyL1Snapshot ?? '').trim()
    if (snapshot) seen.add(snapshot)
  }
  return [...seen]
}

/**
 * @param {ActionItem} item
 * @param {string} problemType
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function actionItemMatchesProblemTypeFilter(item, problemType, feedbackByTicketId) {
  const needle = String(problemType ?? '').trim()
  if (!needle) return true
  return collectProblemTypesFromItem(item, feedbackByTicketId).includes(needle)
}

/**
 * @param {ActionItem} item
 * @param {string} journeyL1
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function actionItemMatchesJourneyL1Filter(item, journeyL1, feedbackByTicketId) {
  const needle = String(journeyL1 ?? '').trim()
  if (!needle) return true
  return collectJourneyL1FromItem(item, feedbackByTicketId).includes(needle)
}

/**
 * @param {ActionItem[]} items
 * @param {Map<string, ActionItemFeedbackLookup | FeedbackRecord>} [feedbackByTicketId]
 */
export function buildActionItemProblemTypeFilterOptions(items, feedbackByTicketId) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const item of items) {
    for (const value of collectProblemTypesFromItem(item, feedbackByTicketId)) {
      counts.set(value, (counts.get(value) || 0) + 1)
    }
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
    for (const value of collectJourneyL1FromItem(item, feedbackByTicketId)) {
      counts.set(value, (counts.get(value) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'zh-CN'))
    .map(([name]) => ({ label: name, value: name }))
}
