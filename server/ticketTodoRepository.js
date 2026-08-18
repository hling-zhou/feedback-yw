/**
 * 会议待办清单：扫描投诉/咨询工单 payload 中的 ticketTodo.items。
 */

import { getDb } from './db.js'
import { storageRepository } from './storageRepository.js'
import { recordMatchesPeriod } from '../src/domain/insightPeriod.js'
import {
  TICKET_TODO_RESOLUTIONS,
  TICKET_TODO_UNASSIGNED_ASSIGNEE,
  aggregateTicketTodosByProductStatus,
  collectTicketTodoFacets,
  computeSharePercent,
  createEmptyTicketTodoResolutionCounts,
  flattenTicketTodosFromRecord,
  isTicketTodoResolution,
} from '../src/domain/ticketTodo.js'
import { buildProductNameByKeyMap } from '../src/lib/productCatalog.js'
import { importMonthRangeForPeriod } from './recordIndex.js'

/** @typedef {import('../src/domain/ticketTodo.js').TicketTodoRow} TicketTodoRow */
/** @typedef {import('../src/domain/ticketTodo.js').TicketTodoResolution} TicketTodoResolution */

/**
 * @typedef {Object} TicketTodoListQuery
 * @property {string} [productKey]
 * @property {string} [productKeys]
 * @property {TicketTodoResolution} [status]
 * @property {string} [statuses]
 * @property {string} [dataSourceType]
 * @property {string} [dataSourceTypes]
 * @property {string} [assigneeUserId]
 * @property {string} [assigneeUserIds]
 * @property {string} [ticketId]
 * @property {string} [insightPeriodId]
 * @property {string} [search]
 * @property {number} [limit]
 * @property {number} [offset]
 */

function parseCsv(value) {
  return String(value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

function parseJson(text) {
  return JSON.parse(text)
}

/**
 * @param {TicketTodoListQuery} query
 */
function loadTicketRecords(query = {}) {
  const db = getDb()
  const periodId = query.insightPeriodId?.trim()
  const period = periodId ? storageRepository.getInsightPeriod(periodId) : null
  if (periodId && !period) return []

  /** @type {string[]} */
  const clauses = [`data_source_type IN ('complaint_ticket', 'consultation_ticket')`]
  /** @type {unknown[]} */
  const params = []

  if (period) {
    const { startMonth, endMonth } = importMonthRangeForPeriod(period)
    clauses.push('import_month >= ? AND import_month <= ?')
    params.push(startMonth, endMonth)
  }

  const rows = db
    .prepare(`SELECT payload FROM records WHERE ${clauses.join(' AND ')}`)
    .all(...params)
    .map((row) => parseJson(row.payload))

  if (!period) return rows
  return rows.filter((record) => recordMatchesPeriod(record, period))
}

/**
 * @param {TicketTodoListQuery} query
 * @param {TicketTodoRow[]} rows
 */
function filterTicketTodoRows(query, rows) {
  let filtered = rows

  const productKeys = [
    ...(query.productKey?.trim() ? [query.productKey.trim()] : []),
    ...parseCsv(query.productKeys),
  ]
  const uniqueProductKeys = [...new Set(productKeys)]
  if (uniqueProductKeys.length) {
    const set = new Set(uniqueProductKeys)
    filtered = filtered.filter((row) => set.has(row.productKey || ''))
  }

  const statuses = [
    ...(isTicketTodoResolution(query.status) ? [query.status] : []),
    ...parseCsv(query.statuses).filter(isTicketTodoResolution),
  ]
  const uniqueStatuses = [...new Set(statuses)]
  if (uniqueStatuses.length) {
    const set = new Set(uniqueStatuses)
    filtered = filtered.filter((row) => set.has(row.resolution))
  }

  const sources = [
    ...(query.dataSourceType?.trim() ? [query.dataSourceType.trim()] : []),
    ...parseCsv(query.dataSourceTypes),
  ]
  const uniqueSources = [...new Set(sources)]
  if (uniqueSources.length) {
    const set = new Set(uniqueSources)
    filtered = filtered.filter((row) => set.has(row.dataSourceType))
  }

  const assignees = [
    ...(query.assigneeUserId?.trim() ? [query.assigneeUserId.trim()] : []),
    ...parseCsv(query.assigneeUserIds),
  ]
  const uniqueAssignees = [...new Set(assignees)]
  if (uniqueAssignees.length) {
    const set = new Set(uniqueAssignees)
    filtered = filtered.filter((row) => {
      if (!row.assigneeUserId) return set.has(TICKET_TODO_UNASSIGNED_ASSIGNEE)
      return set.has(row.assigneeUserId)
    })
  }

  if (query.ticketId?.trim()) {
    const tid = query.ticketId.trim()
    filtered = filtered.filter((row) => row.ticketId === tid)
  }

  if (query.search?.trim()) {
    const needle = query.search.trim().toLowerCase()
    filtered = filtered.filter((row) => row.text.toLowerCase().includes(needle))
  }

  return filtered
}

/**
 * @param {TicketTodoListQuery} [query]
 */
function collectTicketTodoRows(query = {}) {
  const productNameByKey = buildProductNameByKeyMap()
  const records = loadTicketRecords(query)
  const rows = records.flatMap((record) => flattenTicketTodosFromRecord(record, productNameByKey))
  return filterTicketTodoRows(query, rows)
}

/**
 * @param {TicketTodoListQuery} [query]
 */
function listTicketTodos(query = {}) {
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500)
  const offset = Math.max(Number(query.offset) || 0, 0)
  const filtered = collectTicketTodoRows(query)
  const total = filtered.length
  const items = filtered.slice(offset, offset + limit)
  return { items, total, limit, offset }
}

/**
 * @param {TicketTodoListQuery} [query]
 */
function getTicketTodoStats(query = {}) {
  const rows = collectTicketTodoRows(query)
  const counts = createEmptyTicketTodoResolutionCounts()
  for (const row of rows) {
    counts[row.resolution] += 1
  }
  const total = TICKET_TODO_RESOLUTIONS.reduce((sum, status) => sum + counts[status], 0)
  return {
    counts,
    total,
    conversionRate: computeSharePercent(counts.converted_to_action, total),
    byProduct: aggregateTicketTodosByProductStatus(rows, buildProductNameByKeyMap()),
    facets: collectTicketTodoFacets(rows),
  }
}

export const ticketTodoRepository = {
  listTicketTodos,
  getTicketTodoStats,
}
