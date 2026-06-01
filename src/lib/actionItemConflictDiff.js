import { ACTION_ITEM_STATUS_LABELS } from '../domain/actionItem.js'

/** @typedef {import('../domain/actionItem.js').ActionItem} ActionItem */

/**
 * @typedef {{ key: string; label: string; server: string; yours: string }} ActionItemConflictDiffRow
 */

/**
 * @param {ActionItem | null | undefined} item
 * @returns {{ content: string; status: string; scheduleAt: string }}
 */
function snapshotFields(item) {
  return {
    content: item?.content?.trim() || '—',
    status: item?.status ? ACTION_ITEM_STATUS_LABELS[item.status] || item.status : '—',
    scheduleAt: item?.scheduleAt?.trim() || '—',
  }
}

/**
 * @param {ActionItem | null | undefined} serverItem
 * @param {{ content: string; status: ActionItem['status']; scheduleAt: string }} draft
 * @returns {ActionItemConflictDiffRow[]}
 */
export function buildActionItemConflictDiff(serverItem, draft) {
  const server = snapshotFields(serverItem)
  const yours = {
    content: draft.content?.trim() || '—',
    status: ACTION_ITEM_STATUS_LABELS[draft.status] || draft.status,
    scheduleAt: draft.scheduleAt?.trim() || '—',
  }
  /** @type {ActionItemConflictDiffRow[]} */
  const rows = []
  if (server.content !== yours.content) {
    rows.push({ key: 'content', label: '举措内容', server: server.content, yours: yours.content })
  }
  if (server.status !== yours.status) {
    rows.push({ key: 'status', label: '状态', server: server.status, yours: yours.status })
  }
  if (server.scheduleAt !== yours.scheduleAt) {
    rows.push({ key: 'scheduleAt', label: '排期', server: server.scheduleAt, yours: yours.scheduleAt })
  }
  return rows
}
