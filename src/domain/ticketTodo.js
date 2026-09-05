/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/recordRevision.js').RecordUpdatedBy} RecordUpdatedBy */

import { randomId } from '../lib/randomId.js'
import { resolveActionItemProductDisplayName } from './actionItem.js'

/**
 * @typedef {'open' | 'converted_to_action' | 'processed_without_action'} TicketTodoResolution
 */

/**
 * @typedef {Object} TicketTodoAssignee
 * @property {string} userId
 * @property {string} username
 */

/**
 * @typedef {Object} TicketTodoIncomingRef
 * @property {string} hostRecordId
 * @property {string} hostTicketId
 * @property {string} itemId
 * @property {string} text
 * @property {TicketTodoResolution} resolution
 * @property {TicketTodoAssignee[]} assignees
 * @property {string[]} linkedTicketIds
 */

/**
 * @typedef {Object} TicketTodoItem
 * @property {string} id
 * @property {string} text
 * @property {boolean} done
 * @property {TicketTodoResolution} resolution
 * @property {string} [assigneeUserId]
 * @property {string} [assigneeUsername]
 * @property {TicketTodoAssignee[]} [assignees]
 * @property {string[]} [linkedTicketIds]
 * @property {string} [processNote]
 * @property {string} [linkedActionId]
 * @property {string} [createdAt]
 * @property {string} [updatedAt]
 * @property {RecordUpdatedBy} [updatedBy]
 */

/**
 * @typedef {Object} TicketTodo
 * @property {TicketTodoItem[]} items
 * @property {string} updatedAt
 * @property {RecordUpdatedBy} updatedBy
 */

/**
 * @typedef {Object} TicketTodoRow
 * @property {string} id
 * @property {string} recordId
 * @property {string} ticketId
 * @property {string} ticketTodoItemId
 * @property {import('./enums.js').DataSourceType | string} dataSourceType
 * @property {string} productKey
 * @property {string} productName
 * @property {string} painPoint
 * @property {string} problemType
 * @property {string} journeyL1
 * @property {string} journeyL2
 * @property {string} text
 * @property {TicketTodoResolution} resolution
 * @property {string} assigneeUserId
 * @property {string} assigneeUsername
 * @property {TicketTodoAssignee[]} [assignees]
 * @property {string[]} [linkedTicketIds]
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {RecordUpdatedBy} [updatedBy]
 * @property {string} processNote
 * @property {string} linkedActionId
 * @property {FeedbackRecord} [record]
 */

export const TICKET_TODO_TEXT_MAX_LENGTH = 200
export const TICKET_TODO_PROCESS_NOTE_MAX_LENGTH = 500
export const TICKET_TODO_UNASSIGNED_ASSIGNEE = '__unassigned__'
export const TICKET_TODO_ASSIGNEE_MAX = 20
export const TICKET_TODO_LINKED_TICKET_MAX = 500

/** @type {TicketTodoResolution[]} */
export const TICKET_TODO_RESOLUTIONS = [
  'open',
  'converted_to_action',
  'processed_without_action',
]

/** @type {Record<TicketTodoResolution, string>} */
export const TICKET_TODO_RESOLUTION_LABELS = {
  open: '未处理',
  converted_to_action: '已转举措',
  processed_without_action: '已处理无举措',
}

/** @type {{ value: TicketTodoResolution; label: string }[]} */
export const TICKET_TODO_RESOLUTION_SELECT_OPTIONS = TICKET_TODO_RESOLUTIONS.map((value) => ({
  value,
  label: TICKET_TODO_RESOLUTION_LABELS[value],
}))

/** 工单详情未处理待办可手选的状态：已转举措只能由确立举措写入。 */
export const TICKET_TODO_MANUAL_RESOLUTION_SELECT_OPTIONS =
  TICKET_TODO_RESOLUTION_SELECT_OPTIONS.filter((item) => item.value !== 'converted_to_action')

export const TICKET_TODO_SOURCE_TYPES = /** @type {const} */ ([
  'complaint_ticket',
  'consultation_ticket',
])

/**
 * @param {unknown} value
 */
function norm(value) {
  return String(value ?? '').trim()
}

/**
 * @param {unknown} entry
 * @returns {TicketTodoAssignee[]}
 */
export function normalizeTicketTodoAssignees(entry) {
  const raw = entry && typeof entry === 'object' ? /** @type {Record<string, unknown>} */ (entry) : {}
  /** @type {TicketTodoAssignee[]} */
  const out = []
  const seen = new Set()
  const list = Array.isArray(raw.assignees) ? raw.assignees : null
  if (list?.length) {
    for (const row of list) {
      if (!row || typeof row !== 'object') continue
      const userId = norm(/** @type {{ userId?: string }} */ (row).userId)
      if (!userId || seen.has(userId)) continue
      seen.add(userId)
      out.push({
        userId,
        username: norm(/** @type {{ username?: string }} */ (row).username) || userId,
      })
      if (out.length >= TICKET_TODO_ASSIGNEE_MAX) break
    }
    return out
  }
  const userId = norm(raw.assigneeUserId)
  if (userId) {
    out.push({
      userId,
      username: norm(raw.assigneeUsername) || userId,
    })
  }
  return out
}

/**
 * @param {TicketTodoAssignee[]} assignees
 */
export function ticketTodoAssigneesKey(assignees) {
  return (assignees || [])
    .map((item) => item.userId)
    .filter(Boolean)
    .sort()
    .join('\n')
}

/**
 * @param {unknown} item
 * @param {TicketTodoAssignee[]} assignees
 */
export function applyTicketTodoAssigneeScalars(item, assignees) {
  const first = assignees[0]
  return {
    ...item,
    assignees,
    assigneeUserId: first?.userId || '',
    assigneeUsername: first?.username || '',
  }
}

/**
 * @param {unknown} entry
 * @param {string} [hostTicketId]
 * @returns {string[]}
 */
export function normalizeTicketTodoLinkedTicketIds(entry, hostTicketId) {
  const host = norm(hostTicketId)
  const raw =
    entry && typeof entry === 'object' && Array.isArray(/** @type {{ linkedTicketIds?: unknown }} */ (entry).linkedTicketIds)
      ? /** @type {{ linkedTicketIds: unknown[] }} */ (entry).linkedTicketIds
      : []
  /** @type {string[]} */
  const ids = []
  const seen = new Set()
  if (host) {
    ids.push(host)
    seen.add(host)
  }
  for (const value of raw) {
    const tid = norm(value)
    if (!tid || seen.has(tid)) continue
    seen.add(tid)
    ids.push(tid)
    if (ids.length >= TICKET_TODO_LINKED_TICKET_MAX) break
  }
  return ids
}

/**
 * @param {unknown} raw
 * @returns {TicketTodoIncomingRef[]}
 */
export function normalizeTicketTodoIncoming(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {TicketTodoIncomingRef[]} */
  const out = []
  const seen = new Set()
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue
    const hostRecordId = norm(/** @type {{ hostRecordId?: string }} */ (entry).hostRecordId)
    const itemId = norm(/** @type {{ itemId?: string }} */ (entry).itemId)
    const text = norm(/** @type {{ text?: string }} */ (entry).text).slice(0, TICKET_TODO_TEXT_MAX_LENGTH)
    if (!hostRecordId || !itemId || !text) continue
    const key = `${hostRecordId}::${itemId}`
    if (seen.has(key)) continue
    seen.add(key)
    const hostTicketId = norm(/** @type {{ hostTicketId?: string }} */ (entry).hostTicketId)
    const assignees = normalizeTicketTodoAssignees(entry)
    out.push({
      hostRecordId,
      hostTicketId,
      itemId,
      text,
      resolution: getTicketTodoResolution(entry),
      assignees,
      linkedTicketIds: normalizeTicketTodoLinkedTicketIds(entry, hostTicketId),
    })
  }
  return out
}

/**
 * @param {unknown} a
 * @param {unknown} b
 */
export function ticketTodoIncomingEqual(a, b) {
  const left = normalizeTicketTodoIncoming(a)
  const right = normalizeTicketTodoIncoming(b)
  if (left.length !== right.length) return false
  const keyOf = (row) => `${row.hostRecordId}::${row.itemId}`
  const sort = (rows) => [...rows].sort((p, q) => keyOf(p).localeCompare(keyOf(q)))
  const L = sort(left)
  const R = sort(right)
  for (let i = 0; i < L.length; i += 1) {
    if (keyOf(L[i]) !== keyOf(R[i])) return false
    if (L[i].text !== R[i].text) return false
    if (L[i].resolution !== R[i].resolution) return false
    if (ticketTodoAssigneesKey(L[i].assignees) !== ticketTodoAssigneesKey(R[i].assignees)) return false
  }
  return true
}

/**
 * @param {FeedbackRecord} hostRecord
 * @param {TicketTodoItem} item
 * @returns {TicketTodoIncomingRef}
 */
export function buildTicketTodoIncomingRef(hostRecord, item) {
  const assignees = normalizeTicketTodoAssignees(item)
  return {
    hostRecordId: norm(hostRecord.id),
    hostTicketId: norm(hostRecord.ticketId),
    itemId: item.id,
    text: item.text,
    resolution: getTicketTodoResolution(item),
    assignees,
    linkedTicketIds: normalizeTicketTodoLinkedTicketIds(item, hostRecord.ticketId),
  }
}

/**
 * @param {TicketTodoItem} item
 * @param {string} hostTicketId
 * @param {string} ticketId
 */
export function linkTicketToTodoItem(item, hostTicketId, ticketId) {
  const linkedTicketIds = normalizeTicketTodoLinkedTicketIds(
    { linkedTicketIds: [...normalizeTicketTodoLinkedTicketIds(item, hostTicketId), ticketId] },
    hostTicketId,
  )
  return { ...item, linkedTicketIds }
}

/**
 * @param {TicketTodoItem} item
 * @param {string} hostTicketId
 * @param {string} ticketId
 */
export function unlinkTicketFromTodoItem(item, hostTicketId, ticketId) {
  const host = norm(hostTicketId)
  const tid = norm(ticketId)
  if (!tid || tid === host) return item
  const linkedTicketIds = normalizeTicketTodoLinkedTicketIds(item, host).filter((id) => id !== tid)
  return { ...item, linkedTicketIds }
}

/**
 * @param {TicketTodoItem | TicketTodoIncomingRef | null | undefined} item
 * @param {string} userId
 */
export function ticketTodoItemAssignedTo(item, userId) {
  const uid = norm(userId)
  if (!uid) return false
  return normalizeTicketTodoAssignees(item).some((row) => row.userId === uid)
}

/**
 * @param {unknown} value
 * @returns {value is TicketTodoResolution}
 */
export function isTicketTodoResolution(value) {
  return TICKET_TODO_RESOLUTIONS.includes(/** @type {TicketTodoResolution} */ (value))
}

/**
 * @param {unknown} raw
 * @returns {RecordUpdatedBy | undefined}
 */
function normalizeUpdatedBy(raw) {
  if (!raw || typeof raw !== 'object') return undefined
  const userId = norm(/** @type {{ userId?: string }} */ (raw).userId)
  if (!userId) return undefined
  const username = norm(/** @type {{ username?: string }} */ (raw).username) || userId
  return { userId, username }
}

/**
 * @param {unknown} entry
 * @returns {TicketTodoResolution}
 */
export function getTicketTodoResolution(entry) {
  if (!entry || typeof entry !== 'object') return 'open'
  const raw = /** @type {{ resolution?: unknown; done?: unknown }} */ (entry).resolution
  if (isTicketTodoResolution(raw)) return raw
  return /** @type {{ done?: unknown }} */ (entry).done ? 'processed_without_action' : 'open'
}

/**
 * @param {TicketTodoResolution} resolution
 */
export function ticketTodoResolutionImpliesDone(resolution) {
  return resolution !== 'open'
}

/**
 * @param {TicketTodoItem | null | undefined} item
 */
export function isTicketTodoOpen(item) {
  return getTicketTodoResolution(item) === 'open'
}

/**
 * @param {number} part
 * @param {number} total
 */
export function computeSharePercent(part, total) {
  if (!total) return 0
  return Math.round((Number(part) / Number(total)) * 1000) / 10
}

/**
 * @param {number} percent
 */
export function formatSharePercent(percent) {
  const n = Number(percent)
  if (!Number.isFinite(n)) return '0%'
  return `${Number.isInteger(n) ? String(n) : n.toFixed(1)}%`
}

/** @typedef {'establish_action' | 'no_action'} TicketTodoProcessMode */

export const TICKET_TODO_PROCESS_MODE = {
  ESTABLISH_ACTION: /** @type {const} */ ('establish_action'),
  NO_ACTION: /** @type {const} */ ('no_action'),
}

function hasEstablishedActionInProcessInput(input) {
  const content = norm(input?.establishedActionContent)
  const actionId = norm(input?.actionId)
  return Boolean(content || (input?.linkedFromLibrary && actionId))
}

/**
 * 处理提交：按单选路径判定。制定举措 → 已转举措；无举措且勾选已处理 → 已处理无举措；否则保持未处理。
 * 未传 processMode 时回退为旧规则（有举措内容优先于勾选）。
 *
 * @param {{
 *   processMode?: TicketTodoProcessMode | string
 *   establishedActionContent?: string
 *   actionId?: string
 *   linkedFromLibrary?: boolean
 *   markProcessed?: boolean
 * }} input
 * @returns {TicketTodoResolution}
 */
export function resolveTicketTodoProcessResolution(input) {
  const mode = String(input?.processMode || '').trim()
  if (mode === TICKET_TODO_PROCESS_MODE.NO_ACTION) {
    return input?.markProcessed ? 'processed_without_action' : 'open'
  }
  if (mode === TICKET_TODO_PROCESS_MODE.ESTABLISH_ACTION) {
    return hasEstablishedActionInProcessInput(input) ? 'converted_to_action' : 'open'
  }
  if (hasEstablishedActionInProcessInput(input)) return 'converted_to_action'
  if (input?.markProcessed) return 'processed_without_action'
  return 'open'
}

/**
 * @param {TicketTodoResolution} resolution
 */
export function shouldPersistEstablishedActionOnProcess(resolution) {
  return resolution === 'converted_to_action'
}

/**
 * 工单详情本次新确立举措时，未处理待办视为已转举措。
 *
 * @param {TicketTodoItem[]} items
 * @param {{ hadAction?: boolean; nowHasAction?: boolean; linkedActionId?: string }} [options]
 * @returns {TicketTodoItem[]}
 */
export function markOpenTicketTodosConvertedWhenEstablishingAction(items, options = {}) {
  if (options.hadAction || !options.nowHasAction) return items
  return items.map((item) => {
    if (!isTicketTodoOpen(item)) return item
    return applyTicketTodoResolutionToItem(item, 'converted_to_action', {
      linkedActionId: options.linkedActionId,
    })
  })
}

/**
 * @param {unknown} entry
 * @param {FeedbackRecord | null | undefined} [record]
 */
export function resolveTicketTodoCreatedAt(entry, record) {
  if (entry && typeof entry === 'object') {
    const createdAt = norm(/** @type {{ createdAt?: unknown }} */ (entry).createdAt)
    if (createdAt) return createdAt
    const updatedAt = norm(/** @type {{ updatedAt?: unknown }} */ (entry).updatedAt)
    if (updatedAt) return updatedAt
  }
  return norm(record?.createdAt) || norm(record?.importedAt)
}

/**
 * @param {TicketTodoItem} item
 * @param {TicketTodoResolution} resolution
 * @param {{ processNote?: string; linkedActionId?: string }} [extras]
 * @returns {TicketTodoItem}
 */
export function applyTicketTodoResolutionToItem(item, resolution, extras = {}) {
  const next = {
    ...item,
    resolution,
    done: ticketTodoResolutionImpliesDone(resolution),
  }
  if (extras.processNote != null) {
    next.processNote = norm(extras.processNote).slice(0, TICKET_TODO_PROCESS_NOTE_MAX_LENGTH)
  }
  if (extras.linkedActionId != null) {
    next.linkedActionId = norm(extras.linkedActionId)
  }
  return next
}

/**
 * 终态（已转举措 / 已处理无举措）不可改回未处理。
 *
 * @param {TicketTodoResolution | undefined} previous
 * @param {TicketTodoResolution} next
 * @returns {TicketTodoResolution}
 */
export function lockTicketTodoResolution(previous, next) {
  if (previous === 'converted_to_action' || previous === 'processed_without_action') {
    return previous
  }
  return next
}

/**
 * @param {unknown} entry
 * @returns {TicketTodoItem | null}
 */
function normalizeTicketTodoItem(entry) {
  if (!entry || typeof entry !== 'object') return null
  const text = norm(/** @type {{ text?: string }} */ (entry).text).slice(0, TICKET_TODO_TEXT_MAX_LENGTH)
  if (!text) return null
  const id = norm(/** @type {{ id?: string }} */ (entry).id) || randomId()
  const updatedBy = normalizeUpdatedBy(/** @type {{ updatedBy?: unknown }} */ (entry).updatedBy)
  const updatedAt = norm(/** @type {{ updatedAt?: string }} */ (entry).updatedAt)
  const createdAt = norm(/** @type {{ createdAt?: string }} */ (entry).createdAt)
  const processNote = norm(/** @type {{ processNote?: string }} */ (entry).processNote).slice(
    0,
    TICKET_TODO_PROCESS_NOTE_MAX_LENGTH,
  )
  const linkedActionId = norm(/** @type {{ linkedActionId?: string }} */ (entry).linkedActionId)
  const resolution = getTicketTodoResolution(entry)
  const assignees = normalizeTicketTodoAssignees(entry)
  const first = assignees[0]
  const linkedTicketIds = Array.isArray(/** @type {{ linkedTicketIds?: unknown }} */ (entry).linkedTicketIds)
    ? normalizeTicketTodoLinkedTicketIds(entry)
    : []
  return {
    id,
    text,
    resolution,
    done: ticketTodoResolutionImpliesDone(resolution),
    assignees,
    assigneeUserId: first?.userId || '',
    assigneeUsername: first?.username || '',
    ...(linkedTicketIds.length ? { linkedTicketIds } : {}),
    ...(processNote ? { processNote } : {}),
    ...(linkedActionId ? { linkedActionId } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(updatedAt ? { updatedAt } : {}),
    ...(updatedBy ? { updatedBy } : {}),
  }
}

/**
 * @param {unknown} raw
 * @returns {TicketTodoItem[]}
 */
export function normalizeTicketTodoInput(raw) {
  if (!Array.isArray(raw)) return []
  /** @type {TicketTodoItem[]} */
  const items = []
  for (const entry of raw) {
    const item = normalizeTicketTodoItem(entry)
    if (item) items.push(item)
  }
  return items
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @returns {TicketTodoItem[]}
 */
export function getTicketTodoDraftItems(record) {
  return normalizeTicketTodoInput(record?.ticketTodo?.items).map((item) => ({ ...item }))
}

/**
 * @param {TicketTodoItem} a
 * @param {TicketTodoItem} b
 */
function todoItemContentEqual(a, b) {
  return (
    a.id === b.id &&
    a.text === b.text &&
    a.done === b.done &&
    getTicketTodoResolution(a) === getTicketTodoResolution(b) &&
    ticketTodoAssigneesKey(normalizeTicketTodoAssignees(a)) ===
      ticketTodoAssigneesKey(normalizeTicketTodoAssignees(b)) &&
    normalizeTicketTodoLinkedTicketIds(a).join('\n') ===
      normalizeTicketTodoLinkedTicketIds(b).join('\n') &&
    norm(a.processNote) === norm(b.processNote) &&
    norm(a.linkedActionId) === norm(b.linkedActionId)
  )
}

/**
 * @param {TicketTodoItem[]} a
 * @param {TicketTodoItem[]} b
 */
export function ticketTodoItemsEqual(a, b) {
  const left = normalizeTicketTodoInput(a)
  const right = normalizeTicketTodoInput(b)
  if (left.length !== right.length) return false
  for (let i = 0; i < left.length; i += 1) {
    if (!todoItemContentEqual(left[i], right[i])) return false
  }
  return true
}

/**
 * @param {FeedbackRecord | null | undefined} record
 */
export function hasOpenTicketTodos(record) {
  if (normalizeTicketTodoInput(record?.ticketTodo?.items).some((item) => isTicketTodoOpen(item))) {
    return true
  }
  return normalizeTicketTodoIncoming(record?.ticketTodoIncoming).some((item) => isTicketTodoOpen(item))
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {string} userId
 */
export function hasOpenTicketTodosAssignedTo(record, userId) {
  const uid = norm(userId)
  if (!uid) return false
  if (
    normalizeTicketTodoInput(record?.ticketTodo?.items).some(
      (item) => isTicketTodoOpen(item) && ticketTodoItemAssignedTo(item, uid),
    )
  ) {
    return true
  }
  return normalizeTicketTodoIncoming(record?.ticketTodoIncoming).some(
    (item) => isTicketTodoOpen(item) && ticketTodoItemAssignedTo(item, uid),
  )
}

/**
 * @param {FeedbackRecord | null | undefined} record
 */
export function getOpenTicketTodoSummary(record) {
  const local = normalizeTicketTodoInput(record?.ticketTodo?.items)
    .filter((item) => isTicketTodoOpen(item))
    .map((item) => `${formatTicketTodoAssigneeLabel(item)}：${item.text}`)
  const incoming = normalizeTicketTodoIncoming(record?.ticketTodoIncoming)
    .filter((item) => isTicketTodoOpen(item))
    .map((item) => `${formatTicketTodoAssigneeLabel(item)}：${item.text}`)
  return [...local, ...incoming].join('；')
}

/**
 * @returns {TicketTodoItem}
 */
export function createEmptyTicketTodoItem() {
  return {
    id: randomId(),
    text: '',
    done: false,
    resolution: 'open',
    assignees: [],
    assigneeUserId: '',
    assigneeUsername: '',
  }
}

/**
 * @param {TicketTodoItem[]} draftItems
 * @param {TicketTodoItem[]} currentItems
 * @param {RecordUpdatedBy} actor
 * @param {string} now
 */
function mergeTicketTodoItemsForSave(draftItems, currentItems, actor, now, hostTicketId) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]))
  /** @type {TicketTodoItem[]} */
  const next = []

  for (const draft of draftItems) {
    const text = norm(draft.text).slice(0, TICKET_TODO_TEXT_MAX_LENGTH)
    if (!text) continue
    const prev = currentById.get(draft.id)
    const prevResolution = prev ? getTicketTodoResolution(prev) : undefined
    const draftResolution = lockTicketTodoResolution(prevResolution, getTicketTodoResolution(draft))
    const processNote = norm(draft.processNote || prev?.processNote).slice(
      0,
      TICKET_TODO_PROCESS_NOTE_MAX_LENGTH,
    )
    const linkedActionId = norm(draft.linkedActionId || prev?.linkedActionId)
    const createdAt = prev?.createdAt || now
    const assignees = normalizeTicketTodoAssignees(
      Array.isArray(draft.assignees) || norm(draft.assigneeUserId) ? draft : prev,
    )
    const linkedTicketIds = normalizeTicketTodoLinkedTicketIds(
      {
        linkedTicketIds:
          Array.isArray(draft.linkedTicketIds) && draft.linkedTicketIds.length
            ? draft.linkedTicketIds
            : prev?.linkedTicketIds,
      },
      hostTicketId,
    )
    const candidate = applyTicketTodoAssigneeScalars(
      {
        id: draft.id || randomId(),
        text,
        resolution: draftResolution,
        done: ticketTodoResolutionImpliesDone(draftResolution),
        linkedTicketIds,
        ...(processNote ? { processNote } : {}),
        ...(linkedActionId ? { linkedActionId } : {}),
        createdAt,
      },
      assignees,
    )
    const changed = !prev || !todoItemContentEqual(prev, candidate)

    if (changed) {
      next.push({
        ...candidate,
        updatedAt: now,
        updatedBy: {
          userId: actor.userId,
          username: actor.username || actor.userId,
        },
      })
    } else {
      next.push({
        ...candidate,
        ...(prev.updatedAt ? { updatedAt: prev.updatedAt } : {}),
        ...(prev.updatedBy ? { updatedBy: prev.updatedBy } : {}),
      })
    }
  }

  return next
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {TicketTodoItem[]} draftItems
 * @param {RecordUpdatedBy | null | undefined} actor
 * @returns {{ ticketTodo?: TicketTodo }}
 */
export function buildTicketTodoSavePatch(record, draftItems, actor) {
  if (!actor?.userId) {
    throw new Error('保存待办需要登录用户')
  }
  const currentItems = normalizeTicketTodoInput(record?.ticketTodo?.items)
  const now = new Date().toISOString()
  const nextItems = mergeTicketTodoItemsForSave(
    draftItems,
    currentItems,
    actor,
    now,
    record?.ticketId,
  )

  if (ticketTodoItemsEqual(nextItems, currentItems)) {
    return {}
  }

  return {
    ticketTodo: {
      items: nextItems,
      updatedAt: now,
      updatedBy: {
        userId: actor.userId,
        username: actor.username || actor.userId,
      },
    },
  }
}

/**
 * @param {TicketTodoItem | null | undefined} item
 */
export function formatTicketTodoAssigneeLabel(item) {
  const names = normalizeTicketTodoAssignees(item)
    .map((row) => row.username || row.userId)
    .filter(Boolean)
  return names.length ? names.join('、') : '未指定'
}

/**
 * @param {string | null | undefined} iso
 */
export function formatTicketTodoDateTime(iso) {
  const value = norm(iso)
  if (!value) return ''
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return value.replace('T', ' ').slice(0, 19)
  return time.toLocaleString('zh-CN', { hour12: false })
}

/**
 * @param {TicketTodoItem | null | undefined} item
 */
export function formatTicketTodoItemUpdatedLine(item) {
  if (!item?.updatedAt) return ''
  const name = item.updatedBy?.username?.trim() || item.updatedBy?.userId || '未知用户'
  return `${name} · ${formatTicketTodoDateTime(item.updatedAt)}`
}

/**
 * @param {TicketTodo | null | undefined} ticketTodo
 */
export function formatTicketTodoUpdatedLine(ticketTodo) {
  if (!ticketTodo?.updatedAt) return ''
  const name = ticketTodo.updatedBy?.username?.trim() || ticketTodo.updatedBy?.userId || '未知用户'
  return `${name} · ${formatTicketTodoDateTime(ticketTodo.updatedAt)}`
}

/**
 * @param {FeedbackRecord | null | undefined} record
 */
export function isComplaintOrConsultationTicket(record) {
  const type = record?.dataSourceType
  return type === 'complaint_ticket' || type === 'consultation_ticket'
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {Map<string, string>} [productNameByKey]
 * @returns {TicketTodoRow[]}
 */
export function flattenTicketTodosFromRecord(record, productNameByKey) {
  if (!isComplaintOrConsultationTicket(record)) return []
  const items = normalizeTicketTodoInput(record?.ticketTodo?.items)
  if (!items.length) return []
  const productKey = norm(record.productKey)
  const productName = resolveActionItemProductDisplayName(
    { productKey, productName: norm(record.product) },
    productNameByKey,
  )
  const painPoint = norm(record.painPoint) || norm(record.problemSummary)
  const hostTicketId = norm(record.ticketId)
  return items.map((item) => {
    const assignees = normalizeTicketTodoAssignees(item)
    const first = assignees[0]
    return {
      id: `${record.id}::${item.id}`,
      recordId: record.id,
      ticketId: hostTicketId,
      ticketTodoItemId: item.id,
      dataSourceType: record.dataSourceType || 'complaint_ticket',
      productKey,
      productName,
      painPoint,
      problemType: norm(record.problemType),
      journeyL1: norm(record.journeyL1),
      journeyL2: norm(record.journeyL2),
      text: item.text,
      resolution: getTicketTodoResolution(item),
      assignees,
      assigneeUserId: first?.userId || '',
      assigneeUsername: first?.username || '',
      linkedTicketIds: normalizeTicketTodoLinkedTicketIds(item, hostTicketId),
      createdAt: resolveTicketTodoCreatedAt(item, record),
      updatedAt: item.updatedAt || '',
      updatedBy: item.updatedBy,
      processNote: item.processNote || '',
      linkedActionId: item.linkedActionId || '',
      record,
    }
  })
}

/**
 * @returns {Record<TicketTodoResolution, number>}
 */
export function createEmptyTicketTodoResolutionCounts() {
  return Object.fromEntries(TICKET_TODO_RESOLUTIONS.map((status) => [status, 0]))
}

/**
 * @param {TicketTodoRow[]} rows
 * @param {Map<string, string>} [productNameByKey]
 * @returns {{
 *   productKey: string
 *   productName: string
 *   counts: Record<TicketTodoResolution, number>
 *   total: number
 *   rate: number
 * }[]}
 */
export function aggregateTicketTodosByProductStatus(rows, productNameByKey) {
  /** @type {Map<string, { productKey: string; productName: string; counts: Record<TicketTodoResolution, number>; total: number; rate: number }>} */
  const map = new Map()
  for (const row of rows || []) {
    const productKey = row.productKey?.trim() || '_unknown'
    const productName = resolveActionItemProductDisplayName(
      { productKey, productName: row.productName },
      productNameByKey,
    )
    let group = map.get(productKey)
    if (!group) {
      group = {
        productKey,
        productName,
        counts: createEmptyTicketTodoResolutionCounts(),
        total: 0,
        rate: 0,
      }
      map.set(productKey, group)
    }
    const resolution = getTicketTodoResolution(row)
    group.counts[resolution] += 1
    group.total += 1
  }
  return [...map.values()]
    .map((group) => ({
      ...group,
      rate: computeSharePercent(group.counts.converted_to_action, group.total),
    }))
    .sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total
      return a.productName.localeCompare(b.productName, 'zh-CN')
    })
}

/**
 * 全量待办上的筛选项（产品 / 负责人），不受 list limit 截断。
 *
 * @param {TicketTodoRow[]} rows
 * @returns {{
 *   products: { productKey: string; productName: string }[]
 *   assignees: { userId: string; username: string }[]
 *   hasUnassigned: boolean
 * }}
 */
export function collectTicketTodoFacets(rows) {
  /** @type {Map<string, { productKey: string; productName: string }>} */
  const products = new Map()
  /** @type {Map<string, { userId: string; username: string }>} */
  const assignees = new Map()
  let hasUnassigned = false
  for (const row of rows || []) {
    const productKey = row.productKey?.trim() || '_unknown'
    if (!products.has(productKey)) {
      products.set(productKey, {
        productKey,
        productName: row.productName?.trim() || productKey,
      })
    }
    const people = normalizeTicketTodoAssignees(row)
    if (!people.length) {
      hasUnassigned = true
      continue
    }
    for (const person of people) {
      if (!assignees.has(person.userId)) {
        assignees.set(person.userId, {
          userId: person.userId,
          username: person.username || person.userId,
        })
      }
    }
  }
  return {
    products: [...products.values()],
    assignees: [...assignees.values()],
    hasUnassigned,
  }
}
