/**
 * 将 host 工单上的会议待办同步到被关联工单的 ticketTodoIncoming。
 */

import {
  buildTicketTodoIncomingRef,
  buildTicketTodoSavePatch,
  getTicketTodoDraftItems,
  linkTicketToTodoItem,
  normalizeTicketTodoIncoming,
  normalizeTicketTodoLinkedTicketIds,
  ticketTodoIncomingEqual,
  unlinkTicketFromTodoItem,
} from '../domain/ticketTodo.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/ticketTodo.js').TicketTodoItem} TicketTodoItem */

/**
 * @param {string[]} ticketIds
 * @param {{
 *   feedbacks?: FeedbackRecord[]
 *   adapter?: {
 *     listRecordsByTicketIds?: (dataSourceType: string, ticketIds: string[]) => Promise<FeedbackRecord[]>
 *   }
 * }} ctx
 * @returns {Promise<FeedbackRecord[]>}
 */
export async function resolveRecordsByTicketIds(ticketIds, ctx = {}) {
  const wanted = [...new Set((ticketIds || []).map((id) => String(id || '').trim()).filter(Boolean))]
  /** @type {Map<string, FeedbackRecord>} */
  const found = new Map()
  for (const record of ctx.feedbacks || []) {
    const tid = String(record.ticketId || '').trim()
    if (tid && wanted.includes(tid) && !found.has(tid)) found.set(tid, record)
  }
  const missing = wanted.filter((id) => !found.has(id))
  if (missing.length && typeof ctx.adapter?.listRecordsByTicketIds === 'function') {
    for (const source of ['complaint_ticket', 'consultation_ticket']) {
      const rows = await ctx.adapter.listRecordsByTicketIds(source, missing)
      for (const record of rows || []) {
        const tid = String(record.ticketId || '').trim()
        if (tid && !found.has(tid)) found.set(tid, record)
      }
    }
  }
  return wanted.map((id) => found.get(id)).filter(Boolean)
}

/**
 * @param {FeedbackRecord} record
 * @param {string} hostRecordId
 * @param {import('../domain/ticketTodo.js').TicketTodoIncomingRef[]} nextFromHost
 */
export function mergeTicketTodoIncomingFromHost(record, hostRecordId, nextFromHost) {
  const hostId = String(hostRecordId || '').trim()
  const kept = normalizeTicketTodoIncoming(record.ticketTodoIncoming).filter(
    (row) => row.hostRecordId !== hostId,
  )
  return [...kept, ...nextFromHost]
}

/**
 * @param {Object} args
 * @param {FeedbackRecord} args.hostRecord
 * @param {TicketTodoItem[]} args.previousItems
 * @param {TicketTodoItem[]} args.nextItems
 * @param {FeedbackRecord[]} [args.feedbacks]
 * @param {object} [args.adapter]
 * @param {(id: string, patch: Partial<FeedbackRecord>, opts?: object) => Promise<FeedbackRecord>} args.updateFeedback
 */
export async function syncTicketTodoIncoming({
  hostRecord,
  previousItems,
  nextItems,
  feedbacks = [],
  adapter,
  updateFeedback,
}) {
  const hostTid = String(hostRecord.ticketId || '').trim()
  const hostRecordId = String(hostRecord.id || '').trim()
  if (!hostTid || !hostRecordId) return 0

  const affected = new Set()
  for (const item of [...(previousItems || []), ...(nextItems || [])]) {
    for (const tid of normalizeTicketTodoLinkedTicketIds(item, hostTid)) {
      if (tid !== hostTid) affected.add(tid)
    }
  }
  if (!affected.size) return 0

  const records = await resolveRecordsByTicketIds([...affected], { feedbacks, adapter })
  let count = 0
  for (const record of records) {
    if (record.id === hostRecord.id) continue
    const ticketId = String(record.ticketId || '').trim()
    /** @type {import('../domain/ticketTodo.js').TicketTodoIncomingRef[]} */
    const nextFromHost = []
    for (const item of nextItems || []) {
      const linked = normalizeTicketTodoLinkedTicketIds(item, hostTid)
      if (!linked.includes(ticketId)) continue
      nextFromHost.push(buildTicketTodoIncomingRef(hostRecord, item))
    }
    const incoming = mergeTicketTodoIncomingFromHost(record, hostRecordId, nextFromHost)
    if (ticketTodoIncomingEqual(incoming, record.ticketTodoIncoming)) continue
    await updateFeedback(record.id, { ticketTodoIncoming: incoming }, {
      mergeBase: record,
      skipConflictCheck: true,
    })
    count += 1
  }
  return count
}

/**
 * 把已确立举措挂到待办的全部关联工单（host 已由 persistEstablishedActionForTicket 处理）。
 *
 * @param {Object} args
 * @param {string} args.actionId
 * @param {FeedbackRecord} args.hostRecord
 * @param {string[]} args.linkedTicketIds
 * @param {FeedbackRecord[]} [args.feedbacks]
 * @param {object} [args.adapter]
 * @param {(id: string, patch: Partial<FeedbackRecord>, opts?: object) => Promise<FeedbackRecord>} args.updateFeedback
 */
export async function persistEstablishedActionOnLinkedTickets({
  actionId,
  hostRecord,
  linkedTicketIds,
  feedbacks = [],
  adapter,
  updateFeedback,
}) {
  const id = String(actionId || '').trim()
  const hostTid = String(hostRecord.ticketId || '').trim()
  const extras = [...new Set((linkedTicketIds || []).map((tid) => String(tid || '').trim()).filter(Boolean))].filter(
    (tid) => tid !== hostTid,
  )
  if (!id || !extras.length) return 0
  const { persistEstablishedActionForTicket } = await import('./establishedActionPersist.js')
  const records = await resolveRecordsByTicketIds(extras, { feedbacks, adapter })
  let count = 0
  for (const record of records) {
    const patch = await persistEstablishedActionForTicket(record, {
      actionId: id,
      linkedFromLibrary: true,
      content: '',
    })
    if (patch && Object.keys(patch).length) {
      await updateFeedback(record.id, patch, { mergeBase: record, skipConflictCheck: true })
      count += 1
    }
  }
  return count
}

/**
 * 本工单关联 / 取消关联一条已有待办：改 host 的 linkedTicketIds 并同步 incoming。
 *
 * @param {Object} args
 * @param {FeedbackRecord} args.hostRecord
 * @param {string} args.itemId
 * @param {string} args.ticketId
 * @param {'link' | 'unlink'} args.mode
 * @param {{ userId: string; username: string }} args.actor
 * @param {FeedbackRecord[]} [args.feedbacks]
 * @param {object} [args.adapter]
 * @param {(id: string, patch: Partial<FeedbackRecord>, opts?: object) => Promise<FeedbackRecord>} args.updateFeedback
 */
export async function persistTicketTodoLinkChange({
  hostRecord,
  itemId,
  ticketId,
  mode,
  actor,
  feedbacks = [],
  adapter,
  updateFeedback,
}) {
  const previousItems = getTicketTodoDraftItems(hostRecord)
  const nextItems = previousItems.map((item) => {
    if (item.id !== itemId) return item
    return mode === 'link'
      ? linkTicketToTodoItem(item, hostRecord.ticketId, ticketId)
      : unlinkTicketFromTodoItem(item, hostRecord.ticketId, ticketId)
  })
  const patch = buildTicketTodoSavePatch(hostRecord, nextItems, actor)
  let saved = hostRecord
  if (Object.keys(patch).length) {
    saved = await updateFeedback(hostRecord.id, patch, { mergeBase: hostRecord })
  }
  const host = { ...hostRecord, ...saved, ticketId: hostRecord.ticketId, id: hostRecord.id }
  await syncTicketTodoIncoming({
    hostRecord: host,
    previousItems,
    nextItems,
    feedbacks,
    adapter,
    updateFeedback,
  })
  return host
}
