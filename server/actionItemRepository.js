import { getDb } from './db.js'
import { bumpDataRevision } from './dataRevision.js'
import { isActionItemStatus, unlinkTicketFromActionItem } from '../src/domain/actionItem.js'
import { applyActionItemWarningLevel } from '../src/domain/actionItemWarning.js'

/**
 * @typedef {import('../src/domain/actionItem.js').ActionItem} ActionItem
 * @typedef {import('../src/domain/actionItem.js').ActionItemStatus} ActionItemStatus
 */

/**
 * @typedef {Object} ActionItemListQuery
 * @property {string} [productKey]
 * @property {string} [productKeys] - 逗号分隔多选
 * @property {ActionItemStatus} [status]
 * @property {string} [statuses] - 逗号分隔多选
 * @property {string} [ticketId] - 关联工单号
 * @property {string} [firstProposedFrom] - YYYY-MM-DD
 * @property {string} [firstProposedTo] - YYYY-MM-DD
 * @property {string} [search] - content 模糊匹配
 * @property {number} [limit]
 * @property {number} [offset]
 */

/**
 * @typedef {Object} ActionItemListResult
 * @property {ActionItem[]} items
 * @property {number} total
 * @property {number} limit
 * @property {number} offset
 */

function parseJson(text) {
  return JSON.parse(text)
}

function stringifyJson(value) {
  return JSON.stringify(value)
}

/**
 * @param {ActionItem} item
 */
function actionItemIndexFields(item) {
  return {
    productKey: item.productKey?.trim() || '',
    productName: item.productName?.trim() || '',
    status: item.status,
    firstProposedAt: item.firstProposedAt?.trim() || '',
    scheduleAt: item.scheduleAt?.trim() || '',
    warningLevel: item.warningLevel || 'none',
  }
}

/**
 * @param {ActionItemListQuery} query
 * @param {ActionItem[]} items
 */
function filterActionItemsInMemory(query, items) {
  let filtered = items

  if (query.ticketId?.trim()) {
    const tid = query.ticketId.trim()
    filtered = filtered.filter((item) => (item.linkedTicketIds || []).includes(tid))
  }

  if (query.search?.trim()) {
    const needle = query.search.trim().toLowerCase()
    filtered = filtered.filter((item) => item.content.toLowerCase().includes(needle))
  }

  return filtered
}

/**
 * @param {ActionItemListQuery} [query]
 * @returns {ActionItemListResult}
 */
function listActionItems(query = {}) {
  const db = getDb()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500)
  const offset = Math.max(Number(query.offset) || 0, 0)

  /** @type {string[]} */
  const clauses = []
  /** @type {unknown[]} */
  const params = []

  const productKeys = [
    ...(query.productKey?.trim() ? [query.productKey.trim()] : []),
    ...(query.productKeys?.split(',').map((k) => k.trim()).filter(Boolean) || []),
  ]
  const uniqueProductKeys = [...new Set(productKeys)]
  if (uniqueProductKeys.length === 1) {
    clauses.push('product_key = ?')
    params.push(uniqueProductKeys[0])
  }

  const statuses = [
    ...(query.status && isActionItemStatus(query.status) ? [query.status] : []),
    ...(query.statuses?.split(',').map((s) => s.trim()).filter(isActionItemStatus) || []),
  ]
  const uniqueStatuses = [...new Set(statuses)]
  if (uniqueStatuses.length === 1) {
    clauses.push('status = ?')
    params.push(uniqueStatuses[0])
  }
  if (query.firstProposedFrom?.trim()) {
    clauses.push('first_proposed_at >= ?')
    params.push(query.firstProposedFrom.trim())
  }
  if (query.firstProposedTo?.trim()) {
    clauses.push('first_proposed_at <= ?')
    params.push(query.firstProposedTo.trim())
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const rows = db
    .prepare(
      `SELECT payload FROM action_items ${where} ORDER BY first_proposed_at DESC, id DESC`,
    )
    .all(...params)
    .map((row) => /** @type {ActionItem} */ (parseJson(row.payload)))

  let filtered = filterActionItemsInMemory(query, rows)
  if (uniqueProductKeys.length > 1) {
    filtered = filtered.filter((item) => uniqueProductKeys.includes(item.productKey || ''))
  }
  if (uniqueStatuses.length > 1) {
    filtered = filtered.filter((item) => uniqueStatuses.includes(item.status))
  }
  const total = filtered.length
  const items = filtered.slice(offset, offset + limit).map((item) => applyActionItemWarningLevel(item))

  return { items, total, limit, offset }
}

/**
 * @param {string} id
 * @returns {ActionItem | null}
 */
function getActionItem(id) {
  const row = getDb().prepare('SELECT payload FROM action_items WHERE id = ?').get(id)
  if (!row) return null
  return applyActionItemWarningLevel(/** @type {ActionItem} */ (parseJson(row.payload)))
}

/**
 * @param {ActionItem} item
 */
function putActionItem(item) {
  const db = getDb()
  const warned = applyActionItemWarningLevel(item)
  const idx = actionItemIndexFields(warned)
  db.prepare(
    `INSERT OR REPLACE INTO action_items
      (id, product_key, product_name, status, first_proposed_at, schedule_at, warning_level, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    item.id,
    idx.productKey,
    idx.productName,
    idx.status,
    idx.firstProposedAt,
    idx.scheduleAt,
    idx.warningLevel,
    stringifyJson(warned),
  )
  bumpDataRevision()
  return warned
}

/**
 * @param {string} id
 * @returns {boolean}
 */
function deleteActionItem(id) {
  const result = getDb().prepare('DELETE FROM action_items WHERE id = ?').run(id)
  if (result.changes > 0) bumpDataRevision()
  return result.changes > 0
}

/**
 * @returns {Record<ActionItemStatus, number>}
 */
function countActionItemsByStatus() {
  const rows = getDb()
    .prepare('SELECT status, COUNT(*) AS n FROM action_items GROUP BY status')
    .all()
  /** @type {Record<ActionItemStatus, number>} */
  const counts = {
    pending_evaluation: 0,
    in_progress: 0,
    completed: 0,
    suspended: 0,
  }
  for (const row of rows) {
    if (isActionItemStatus(row.status)) counts[row.status] = row.n
  }
  return counts
}

/**
 * @param {{ actionId: string; ticketId: string }[]} links
 * @returns {{ updated: number; items: ActionItem[] }}
 */
function unlinkTicketsFromActionItems(links) {
  /** @type {ActionItem[]} */
  const items = []
  let updated = 0

  for (const link of links) {
    const actionId = String(link.actionId ?? '').trim()
    const ticketId = String(link.ticketId ?? '').trim()
    if (!actionId || !ticketId) continue

    const existing = getActionItem(actionId)
    if (!existing) continue

    const next = unlinkTicketFromActionItem(existing, ticketId)
    if ((existing.linkedTicketIds || []).includes(ticketId)) {
      putActionItem(next)
      items.push(next)
      updated += 1
    }
  }

  return { updated, items }
}

export const actionItemRepository = {
  listActionItems,
  getActionItem,
  putActionItem,
  deleteActionItem,
  countActionItemsByStatus,
  unlinkTicketsFromActionItems,
}
