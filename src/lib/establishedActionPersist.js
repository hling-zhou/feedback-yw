/**
 * 保存工单时同步举措库（P4-2 选库 / P4-3 手动 upsert）。
 */

import {
  createActionItem,
  getActionItem,
  updateActionItem,
  unlinkTicketsFromActionLibrary,
} from '../lib/actionItemClient.js'
import {
  buildClearEstablishedActionRecordPatch,
  buildFirstTicketSnapshotSyncPatch,
  buildLinkedEstablishedActionRecordPatch,
  buildManualEstablishedActionUpsertPayload,
  buildSnapshotPatchOnTicketLink,
  ensureTicketLinkedOnActionItem,
} from '../domain/establishedActionLibrary.js'
import {
  getEstablishedActionDisplay,
  normalizeEstablishedActionInput,
} from '../domain/establishedAction.js'
import { syncLinkedTicketCopies } from './actionItemTicketSync.js'
import { normalizeActionSchedule } from '../domain/actionSchedule.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/**
 * @typedef {Object} PersistEstablishedActionInput
 * @property {string} content
 * @property {string} [scheduleAt]
 * @property {string} [actionId]
 * @property {boolean} [linkedFromLibrary]
 */

/**
 * @param {FeedbackRecord} record
 */
async function unlinkTicketFromPriorAction(record) {
  const actionId = record.actionId?.trim()
  const ticketId = record.ticketId?.trim()
  if (!actionId || !ticketId) return
  await unlinkTicketsFromActionLibrary([{ actionId, ticketId }])
}

/**
 * @param {FeedbackRecord} record
 * @param {string} nextActionId
 */
async function unlinkTicketIfLeavingAction(record, nextActionId) {
  const previousActionId = record.actionId?.trim()
  const ticketId = record.ticketId?.trim()
  if (!previousActionId || !ticketId || previousActionId === nextActionId) return
  await unlinkTicketsFromActionLibrary([{ actionId: previousActionId, ticketId }])
}

/**
 * @param {FeedbackRecord} record
 * @param {PersistEstablishedActionInput} input
 * @returns {Promise<Partial<FeedbackRecord>>}
 */
export async function persistEstablishedActionForTicket(record, input) {
  const content = normalizeEstablishedActionInput(input.content)
  const scheduleAt = normalizeActionSchedule(input.scheduleAt)
  const ticketId = record.ticketId?.trim() || ''
  const dataSourceType = record.dataSourceType

  if (!content) {
    await unlinkTicketFromPriorAction(record)
    return buildClearEstablishedActionRecordPatch()
  }

  if (input.linkedFromLibrary && input.actionId?.trim()) {
    const actionId = input.actionId.trim()
    await unlinkTicketIfLeavingAction(record, actionId)
    const item = await getActionItem(actionId)
    if (!item) {
      throw new Error('关联的举措不存在或已被删除')
    }
    const linked = ensureTicketLinkedOnActionItem(item, ticketId, dataSourceType)
    const snapshotPatch = ticketId ? buildSnapshotPatchOnTicketLink(item, record) : null
    const linkChanged =
      ticketId &&
      (linked.linkedTicketIds?.length !== item.linkedTicketIds?.length ||
        linked.linkedDataSources?.length !== item.linkedDataSources?.length)
    if (linkChanged || snapshotPatch) {
      await updateActionItem(
        actionId,
        {
          linkedTicketIds: linked.linkedTicketIds,
          linkedDataSources: linked.linkedDataSources,
          ...snapshotPatch,
        },
        { skipConflictCheck: true },
      )
    }
    return buildLinkedEstablishedActionRecordPatch(linked)
  }

  const upsertPayload = buildManualEstablishedActionUpsertPayload(record, {
    content,
    scheduleAt,
  })

  const existingId = record.actionId?.trim()
  /** @type {import('../domain/actionItem.js').ActionItem} */
  let item

  if (existingId) {
    const existing = await getActionItem(existingId)
    if (existing) {
      item = await updateActionItem(existingId, upsertPayload, { skipConflictCheck: true })
    } else {
      item = await createActionItem({
        ...upsertPayload,
        linkedTicketIds: ticketId ? [ticketId] : [],
        linkedDataSources: dataSourceType ? [dataSourceType] : [],
      })
    }
  } else {
    item = await createActionItem({
      ...upsertPayload,
      linkedTicketIds: ticketId ? [ticketId] : [],
      linkedDataSources: dataSourceType ? [dataSourceType] : [],
    })
  }

  const linked = ensureTicketLinkedOnActionItem(item, ticketId, dataSourceType)
  if (
    ticketId &&
    (linked.linkedTicketIds?.length !== item.linkedTicketIds?.length ||
      linked.linkedDataSources?.length !== item.linkedDataSources?.length)
  ) {
    item = await updateActionItem(item.id, {
      linkedTicketIds: linked.linkedTicketIds,
      linkedDataSources: linked.linkedDataSources,
    }, { skipConflictCheck: true })
  }

  return {
    ...buildLinkedEstablishedActionRecordPatch(item),
  }
}

/**
 * 首单工单字段变更时同步 ActionItem 快照（P4-8）。
 *
 * @param {FeedbackRecord} record
 * @returns {Promise<import('../domain/actionItem.js').ActionItem | null>}
 */
export async function syncFirstTicketSnapshotsForRecord(record) {
  const actionId = record.actionId?.trim()
  const ticketId = record.ticketId?.trim()
  if (!actionId || !ticketId) return null

  const item = await getActionItem(actionId)
  if (!item) return null

  const patch = buildFirstTicketSnapshotSyncPatch(item, record)
  if (!patch) return item

  const unchanged =
    patch.painPointSnapshot === (item.painPointSnapshot || '') &&
    patch.problemTypeSnapshot === (item.problemTypeSnapshot || '') &&
    patch.journeyL1Snapshot === (item.journeyL1Snapshot || '')
  if (unchanged) return item

  return updateActionItem(actionId, patch, { skipConflictCheck: true })
}

/**
 * 导入分析等批量写入：逐条 upsert 举措库并合并 actionId / 文本副本 patch。
 *
 * @param {FeedbackRecord[]} records
 * @returns {Promise<FeedbackRecord[]>}
 */
export async function mergeEstablishedActionLibraryForRecords(records) {
  /** @type {FeedbackRecord[]} */
  const out = []
  for (const record of records) {
    const patch = await persistEstablishedActionForTicket(record, {
      content: getEstablishedActionDisplay(record),
      scheduleAt: record.actionSchedule || '',
      linkedFromLibrary: false,
    })
    out.push({ ...record, ...patch })
  }
  return out
}

/**
 * 将举措库最新 content/排期同步到所有关联工单的文本副本。
 *
 * @param {string[]} actionIds
 * @param {FeedbackRecord[]} feedbacks
 * @param {(id: string, patch: Partial<FeedbackRecord>, opts?: object) => Promise<FeedbackRecord>} updateFeedback
 * @returns {Promise<number>}
 */
export async function syncLinkedTicketsForActionIds(actionIds, feedbacks, updateFeedback) {
  let total = 0
  for (const rawId of actionIds) {
    const actionId = String(rawId ?? '').trim()
    if (!actionId) continue
    const item = await getActionItem(actionId)
    if (!item) continue
    total += await syncLinkedTicketCopies(item, feedbacks, updateFeedback)
  }
  return total
}
