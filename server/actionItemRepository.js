import { getDb } from './db.js'
import { bumpDataRevision } from './dataRevision.js'
import { isActionItemStatus, unlinkTicketFromActionItem } from '../src/domain/actionItem.js'
import {
  actionItemHasLinkedTicketInPeriod,
  buildTicketIdSetFromRecords,
} from '../src/domain/actionItemPeriodFilter.js'
import {
  applyActionItemWriteMetadata,
  getActionItemRevision,
  ACTION_ITEM_CONFLICT_CODE,
} from '../src/domain/actionItemRevision.js'
import { applyActionItemWarningLevel } from '../src/domain/actionItemWarning.js'
import { storageRepository } from './storageRepository.js'

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
 * @property {string} [insightPeriodId] - 仅保留关联到该周期内工单的举措
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
/**
 * @param {string} insightPeriodId
 * @returns {Set<string>}
 */
function getTicketIdsForInsightPeriod(insightPeriodId) {
  const id = insightPeriodId?.trim()
  if (!id) return new Set()
  const { records } = storageRepository.listRecords({ insightPeriodId: id })
  return buildTicketIdSetFromRecords(records)
}

function filterActionItemsInMemory(query, items) {
  let filtered = items

  if (query.insightPeriodId?.trim()) {
    const ticketIdsInPeriod = getTicketIdsForInsightPeriod(query.insightPeriodId)
    filtered = filtered.filter((item) =>
      actionItemHasLinkedTicketInPeriod(item, ticketIdsInPeriod),
    )
  }

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
 * @returns {{ uniqueProductKeys: string[]; uniqueStatuses: ActionItemStatus[]; items: ActionItem[] }}
 */
function getFilteredActionItems(query = {}) {
  const db = getDb()

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

  return { uniqueProductKeys, uniqueStatuses, items: filtered }
}

/**
 * @param {ActionItemListQuery} [query]
 * @returns {ActionItemListResult}
 */
function listActionItems(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const { items: filtered } = getFilteredActionItems(query)
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
 * @typedef {Object} PutActionItemOptions
 * @property {number} [expectedRevision]
 * @property {{ userId: string; username: string }} [actor]
 * @property {boolean} [skipConflictCheck]
 */

/**
 * @param {ActionItem} item
 * @param {PutActionItemOptions} [options]
 * @returns {ActionItem}
 */
function putActionItem(item, options = {}) {
  const db = getDb()
  const existing = getActionItem(item.id)
  const currentRevision = getActionItemRevision(existing)

  if (
    options.skipConflictCheck !== true &&
    options.expectedRevision != null &&
    options.expectedRevision !== currentRevision
  ) {
    const err = new Error('举措已被他人更新，请刷新后重试')
    err.code = ACTION_ITEM_CONFLICT_CODE
    err.current = existing
    err.currentRevision = currentRevision
    throw err
  }

  const withMeta = applyActionItemWriteMetadata(item, {
    previousRevision: currentRevision,
    actor: options.actor ?? null,
  })
  const warned = applyActionItemWarningLevel(withMeta)
  const idx = actionItemIndexFields(warned)
  db.prepare(
    `INSERT OR REPLACE INTO action_items
      (id, product_key, product_name, status, first_proposed_at, schedule_at, warning_level, payload)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    warned.id,
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
 * @param {ActionItemListQuery} [query]
 * @returns {Record<ActionItemStatus, number>}
 */
function countActionItemsByStatus(query = {}) {
  const { items } = getFilteredActionItems(query)
  /** @type {Record<ActionItemStatus, number>} */
  const counts = {
    pending_evaluation: 0,
    in_progress: 0,
    completed: 0,
    suspended: 0,
  }
  for (const item of items) {
    if (isActionItemStatus(item.status)) counts[item.status] += 1
  }
  return counts
}

/**
 * @typedef {Object} ActionItemProductStatusRow
 * @property {string} productKey
 * @property {string} productName
 * @property {Record<ActionItemStatus, number>} counts
 * @property {number} total
 */

/**
 * @param {ActionItemListQuery} [query]
 * @returns {ActionItemProductStatusRow[]}
 */
function aggregateActionItemsByProductStatus(query = {}) {
  const { items } = getFilteredActionItems(query)
  /** @type {Map<string, ActionItemProductStatusRow>} */
  const map = new Map()

  for (const item of items) {
    const productKey = item.productKey?.trim() || '_unknown'
    const productName = item.productName?.trim() || item.productKey?.trim() || '未标注产品'
    let row = map.get(productKey)
    if (!row) {
      row = {
        productKey,
        productName,
        counts: {
          pending_evaluation: 0,
          in_progress: 0,
          completed: 0,
          suspended: 0,
        },
        total: 0,
      }
      map.set(productKey, row)
    }
    if (isActionItemStatus(item.status)) {
      row.counts[item.status] += 1
      row.total += 1
    }
  }

  return [...map.values()].sort((a, b) => {
    if (b.total !== a.total) return b.total - a.total
    return a.productName.localeCompare(b.productName, 'zh-CN')
  })
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
  aggregateActionItemsByProductStatus,
  unlinkTicketsFromActionItems,
}
