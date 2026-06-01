/**
 * 强制覆盖重打标时解关联举措库（P4-4）。
 * 清空工单侧 actionId；从 ActionItem.linkedTicketIds 移除工单，不 DELETE 举措。
 */

import { unlinkTicketsFromActionLibrary } from './actionItemClient.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {FeedbackRecord[]} records
 * @returns {Promise<{ unlinked: number }>}
 */
export async function unlinkActionItemsForForceRetag(records) {
  /** @type {{ actionId: string; ticketId: string }[]} */
  const links = []
  const seen = new Set()

  for (const record of records) {
    const actionId = record.actionId?.trim()
    const ticketId = record.ticketId?.trim()
    if (!actionId || !ticketId) continue
    const key = `${actionId}::${ticketId}`
    if (seen.has(key)) continue
    seen.add(key)
    links.push({ actionId, ticketId })
  }

  if (!links.length) return { unlinked: 0 }
  const result = await unlinkTicketsFromActionLibrary(links)
  return { unlinked: result.updated }
}
