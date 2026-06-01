/**
 * 保存工单时同步举措库（P4-2 选库 / P4-3 手动 upsert）。
 */

import {
  createActionItem,
  getActionItem,
  updateActionItem,
} from '../lib/actionItemClient.js'
import {
  buildClearEstablishedActionRecordPatch,
  buildFirstTicketSnapshotSyncPatch,
  buildLinkedEstablishedActionRecordPatch,
  buildManualEstablishedActionUpsertPayload,
  ensureTicketLinkedOnActionItem,
} from '../domain/establishedActionLibrary.js'
import { normalizeEstablishedActionInput } from '../domain/establishedAction.js'
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
 * @param {PersistEstablishedActionInput} input
 * @returns {Promise<Partial<FeedbackRecord>>}
 */
export async function persistEstablishedActionForTicket(record, input) {
  const content = normalizeEstablishedActionInput(input.content)
  const scheduleAt = normalizeActionSchedule(input.scheduleAt)
  const ticketId = record.ticketId?.trim() || ''
  const dataSourceType = record.dataSourceType

  if (!content) {
    return buildClearEstablishedActionRecordPatch()
  }

  if (input.linkedFromLibrary && input.actionId?.trim()) {
    const actionId = input.actionId.trim()
    const item = await getActionItem(actionId)
    if (!item) {
      throw new Error('关联的举措不存在或已被删除')
    }
    const linked = ensureTicketLinkedOnActionItem(item, ticketId, dataSourceType)
    if (
      ticketId &&
      (linked.linkedTicketIds?.length !== item.linkedTicketIds?.length ||
        linked.linkedDataSources?.length !== item.linkedDataSources?.length)
    ) {
      await updateActionItem(actionId, {
        linkedTicketIds: linked.linkedTicketIds,
        linkedDataSources: linked.linkedDataSources,
      })
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
      item = await updateActionItem(existingId, upsertPayload)
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
    })
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

  return updateActionItem(actionId, patch)
}
