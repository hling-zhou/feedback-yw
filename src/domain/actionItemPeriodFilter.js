/**
 * @typedef {import('./actionItem.js').ActionItem} ActionItem
 * @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord
 */

/**
 * @param {FeedbackRecord[]} records
 * @returns {Set<string>}
 */
export function buildTicketIdSetFromRecords(records) {
  /** @type {Set<string>} */
  const set = new Set()
  for (const record of records) {
    const ticketId = record?.ticketId?.trim()
    if (ticketId) set.add(ticketId)
  }
  return set
}

/**
 * @param {ActionItem} item
 * @param {Set<string> | null | undefined} ticketIdsInPeriod - null/undefined = 不过滤
 */
export function actionItemHasLinkedTicketInPeriod(item, ticketIdsInPeriod) {
  if (!ticketIdsInPeriod) return true
  if (ticketIdsInPeriod.size === 0) return false
  const linked = item.linkedTicketIds || []
  if (!linked.length) return true
  return linked.some((id) => ticketIdsInPeriod.has(id))
}

/**
 * @param {string[] | undefined} linkedTicketIds
 * @param {Set<string> | null | undefined} ticketIdsInPeriod
 * @returns {string[]}
 */
export function linkedTicketIdsInPeriod(linkedTicketIds, ticketIdsInPeriod) {
  const ids = linkedTicketIds || []
  if (!ticketIdsInPeriod) return ids
  return ids.filter((id) => ticketIdsInPeriod.has(id))
}
