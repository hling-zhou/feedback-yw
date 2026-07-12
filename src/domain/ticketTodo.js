/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/recordRevision.js').RecordUpdatedBy} RecordUpdatedBy */

import { randomId } from '../lib/randomId.js'

/**
 * @typedef {Object} TicketTodoItem
 * @property {string} id
 * @property {string} text
 * @property {boolean} done
 * @property {string} [assigneeUserId]
 * @property {string} [assigneeUsername]
 * @property {string} [updatedAt]
 * @property {RecordUpdatedBy} [updatedBy]
 */

/**
 * @typedef {Object} TicketTodo
 * @property {TicketTodoItem[]} items
 * @property {string} updatedAt
 * @property {RecordUpdatedBy} updatedBy
 */

export const TICKET_TODO_TEXT_MAX_LENGTH = 200

/**
 * @param {unknown} value
 */
function norm(value) {
  return String(value ?? '').trim()
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
 * @returns {TicketTodoItem | null}
 */
function normalizeTicketTodoItem(entry) {
  if (!entry || typeof entry !== 'object') return null
  const text = norm(/** @type {{ text?: string }} */ (entry).text).slice(0, TICKET_TODO_TEXT_MAX_LENGTH)
  if (!text) return null
  const id = norm(/** @type {{ id?: string }} */ (entry).id) || randomId()
  const updatedBy = normalizeUpdatedBy(/** @type {{ updatedBy?: unknown }} */ (entry).updatedBy)
  const updatedAt = norm(/** @type {{ updatedAt?: string }} */ (entry).updatedAt)
  return {
    id,
    text,
    done: Boolean(/** @type {{ done?: boolean }} */ (entry).done),
    assigneeUserId: norm(/** @type {{ assigneeUserId?: string }} */ (entry).assigneeUserId),
    assigneeUsername: norm(/** @type {{ assigneeUsername?: string }} */ (entry).assigneeUsername),
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
    norm(a.assigneeUserId) === norm(b.assigneeUserId)
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
  return normalizeTicketTodoInput(record?.ticketTodo?.items).some((item) => !item.done)
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {string} userId
 */
export function hasOpenTicketTodosAssignedTo(record, userId) {
  const uid = norm(userId)
  if (!uid) return false
  return normalizeTicketTodoInput(record?.ticketTodo?.items).some(
    (item) => !item.done && norm(item.assigneeUserId) === uid,
  )
}

/**
 * @param {FeedbackRecord | null | undefined} record
 */
export function getOpenTicketTodoSummary(record) {
  return normalizeTicketTodoInput(record?.ticketTodo?.items)
    .filter((item) => !item.done)
    .map((item) => {
      const owner = item.assigneeUsername || '未指定'
      return `${owner}：${item.text}`
    })
    .join('；')
}

/**
 * @returns {TicketTodoItem}
 */
export function createEmptyTicketTodoItem() {
  return {
    id: randomId(),
    text: '',
    done: false,
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
function mergeTicketTodoItemsForSave(draftItems, currentItems, actor, now) {
  const currentById = new Map(currentItems.map((item) => [item.id, item]))
  /** @type {TicketTodoItem[]} */
  const next = []

  for (const draft of draftItems) {
    const text = norm(draft.text).slice(0, TICKET_TODO_TEXT_MAX_LENGTH)
    if (!text) continue
    const prev = currentById.get(draft.id)
    const candidate = {
      id: draft.id || randomId(),
      text,
      done: Boolean(draft.done),
      assigneeUserId: norm(draft.assigneeUserId),
      assigneeUsername: norm(draft.assigneeUsername),
    }
    const changed =
      !prev ||
      prev.text !== candidate.text ||
      prev.done !== candidate.done ||
      norm(prev.assigneeUserId) !== candidate.assigneeUserId

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
  const nextItems = mergeTicketTodoItemsForSave(draftItems, currentItems, actor, now)

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
  return item?.assigneeUsername?.trim() || item?.assigneeUserId?.trim() || '未指定'
}

/**
 * @param {TicketTodoItem | null | undefined} item
 */
export function formatTicketTodoItemUpdatedLine(item) {
  if (!item?.updatedAt) return ''
  const name = item.updatedBy?.username?.trim() || item.updatedBy?.userId || '未知用户'
  const time = new Date(item.updatedAt)
  const timeText = Number.isNaN(time.getTime())
    ? item.updatedAt
    : time.toLocaleString('zh-CN', { hour12: false })
  return `${name} · ${timeText}`
}

/**
 * @param {TicketTodo | null | undefined} ticketTodo
 */
export function formatTicketTodoUpdatedLine(ticketTodo) {
  if (!ticketTodo?.updatedAt) return ''
  const name = ticketTodo.updatedBy?.username?.trim() || ticketTodo.updatedBy?.userId || '未知用户'
  const time = new Date(ticketTodo.updatedAt)
  const timeText = Number.isNaN(time.getTime())
    ? ticketTodo.updatedAt
    : time.toLocaleString('zh-CN', { hour12: false })
  return `${name} · ${timeText}`
}
