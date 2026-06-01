/**
 * 举措库变更后同步已关联工单的文本副本（R4）。
 */

import { buildEstablishedActionSavePatch } from '../domain/establishedAction.js'
import { normalizeActionSchedule } from '../domain/actionSchedule.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */
/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {ActionItem} actionItem
 * @returns {Partial<FeedbackRecord>}
 */
export function buildTicketCopyPatchForActionItem(actionItem) {
  return {
    ...buildEstablishedActionSavePatch(actionItem.content),
    actionSchedule: normalizeActionSchedule(actionItem.scheduleAt),
  }
}

/**
 * @param {ActionItem} actionItem
 * @param {FeedbackRecord[]} feedbacks
 * @param {(id: string, patch: Partial<FeedbackRecord>) => Promise<FeedbackRecord>} updateFeedback
 * @returns {Promise<number>}
 */
export async function syncLinkedTicketCopies(actionItem, feedbacks, updateFeedback) {
  const linked = feedbacks.filter((fb) => fb.actionId?.trim() === actionItem.id)
  if (!linked.length) return 0

  const patch = buildTicketCopyPatchForActionItem(actionItem)
  for (const fb of linked) {
    await updateFeedback(fb.id, patch, { skipConflictCheck: true })
  }
  return linked.length
}
