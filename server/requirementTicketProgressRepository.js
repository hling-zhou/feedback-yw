import { getDb } from './db.js'
import { bumpDataRevision } from './dataRevision.js'
import { isActionItemStatus } from '../src/domain/actionItem.js'
import { normalizeRequirementScheduleAt, normalizeRequirementTicketId } from '../src/domain/requirementTicketProgress.js'

/**
 * @typedef {import('../src/domain/requirementTicketProgress.js').RequirementTicketProgressRow} RequirementTicketProgressRow
 * @typedef {import('../src/domain/requirementTicketProgress.js').RequirementStatusMappingRow} RequirementStatusMappingRow
 */

/**
 * @typedef {Object} RequirementTicketProgressListQuery
 * @property {string} [ticketId]
 * @property {string} [product]
 * @property {string} [workflowStatus]
 * @property {number} [limit]
 * @property {number} [offset]
 */

/**
 * @typedef {Object} RequirementTicketProgressImportRow
 * @property {string} ticketId
 * @property {string} [product]
 * @property {string} [scheduleAt]
 * @property {string} [workflowStatus]
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} ticketId
 */
function getProgressRow(db, ticketId) {
  const row = db
    .prepare(
      `SELECT ticket_id, product, schedule_at, workflow_status, imported_at, updated_at
       FROM requirement_ticket_progress WHERE ticket_id = ?`,
    )
    .get(ticketId)
  if (!row) return null
  return {
    ticketId: String(row.ticket_id),
    product: String(row.product || ''),
    scheduleAt: String(row.schedule_at || ''),
    workflowStatus: String(row.workflow_status || ''),
    importedAt: String(row.imported_at),
    updatedAt: String(row.updated_at),
  }
}

/**
 * @param {RequirementTicketProgressListQuery} [query]
 */
function listProgress(query = {}) {
  const db = getDb()
  const limit = Math.min(Math.max(Number(query.limit) || 50, 1), 500)
  const offset = Math.max(Number(query.offset) || 0, 0)

  /** @type {string[]} */
  const clauses = []
  /** @type {unknown[]} */
  const params = []

  if (query.ticketId?.trim()) {
    clauses.push('ticket_id LIKE ?')
    params.push(`%${query.ticketId.trim()}%`)
  }
  if (query.product?.trim()) {
    clauses.push('product LIKE ?')
    params.push(`%${query.product.trim()}%`)
  }
  if (query.workflowStatus?.trim()) {
    clauses.push('workflow_status LIKE ?')
    params.push(`%${query.workflowStatus.trim()}%`)
  }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : ''
  const total = /** @type {{ count: number }} */ (
    db.prepare(`SELECT COUNT(*) AS count FROM requirement_ticket_progress ${where}`).get(...params)
  ).count

  const rows = db
    .prepare(
      `SELECT ticket_id, product, schedule_at, workflow_status, imported_at, updated_at
       FROM requirement_ticket_progress ${where}
       ORDER BY updated_at DESC, ticket_id ASC
       LIMIT ? OFFSET ?`,
    )
    .all(...params, limit, offset)
    .map((row) => ({
      ticketId: String(row.ticket_id),
      product: String(row.product || ''),
      scheduleAt: String(row.schedule_at || ''),
      workflowStatus: String(row.workflow_status || ''),
      importedAt: String(row.imported_at),
      updatedAt: String(row.updated_at),
    }))

  return { items: rows, total, limit, offset }
}

/**
 * @param {string[]} ticketIds
 * @returns {Map<string, RequirementTicketProgressRow>}
 */
function getProgressByTicketIds(ticketIds) {
  const db = getDb()
  const unique = [...new Set(ticketIds.map(normalizeRequirementTicketId).filter(Boolean))]
  /** @type {Map<string, RequirementTicketProgressRow>} */
  const map = new Map()
  if (!unique.length) return map

  const chunkSize = 200
  for (let i = 0; i < unique.length; i += chunkSize) {
    const chunk = unique.slice(i, i + chunkSize)
    const placeholders = chunk.map(() => '?').join(', ')
    const rows = db
      .prepare(
        `SELECT ticket_id, product, schedule_at, workflow_status, imported_at, updated_at
         FROM requirement_ticket_progress WHERE ticket_id IN (${placeholders})`,
      )
      .all(...chunk)
    for (const row of rows) {
      const ticketId = String(row.ticket_id)
      map.set(ticketId, {
        ticketId,
        product: String(row.product || ''),
        scheduleAt: String(row.schedule_at || ''),
        workflowStatus: String(row.workflow_status || ''),
        importedAt: String(row.imported_at),
        updatedAt: String(row.updated_at),
      })
    }
  }

  return map
}

/**
 * @param {RequirementTicketProgressImportRow[]} rows
 */
function importProgressRows(rows) {
  const db = getDb()
  const now = new Date().toISOString()
  /** @type {{ ticketId: string; action: 'inserted' | 'updated' }[]} */
  const changes = []
  /** @type {{ row: number; message: string }[]} */
  const errors = []

  const upsert = db.prepare(
    `INSERT INTO requirement_ticket_progress
      (ticket_id, product, schedule_at, workflow_status, imported_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(ticket_id) DO UPDATE SET
      product = excluded.product,
      schedule_at = excluded.schedule_at,
      workflow_status = excluded.workflow_status,
      imported_at = excluded.imported_at,
      updated_at = excluded.updated_at`,
  )

  const txn = db.transaction((inputRows) => {
    inputRows.forEach((row, index) => {
      const ticketId = normalizeRequirementTicketId(row.ticketId)
      if (!ticketId) {
        errors.push({ row: index + 1, message: '需求工单号不能为空' })
        return
      }
      const scheduleAt = normalizeRequirementScheduleAt(row.scheduleAt)
      if (String(row.scheduleAt ?? '').trim() && !scheduleAt) {
        errors.push({ row: index + 1, message: `工单 ${ticketId} 排期时间无法解析` })
        return
      }
      const existing = getProgressRow(db, ticketId)
      upsert.run(
        ticketId,
        String(row.product ?? '').trim(),
        scheduleAt,
        String(row.workflowStatus ?? '').trim(),
        now,
        now,
      )
      changes.push({ ticketId, action: existing ? 'updated' : 'inserted' })
    })
  })

  txn(rows)
  if (changes.length) bumpDataRevision()
  return {
    inserted: changes.filter((item) => item.action === 'inserted').length,
    updated: changes.filter((item) => item.action === 'updated').length,
    errors,
  }
}

function listStatusMappings() {
  const db = getDb()
  return db
    .prepare(
      `SELECT workflow_status, maps_to_action_status, sort_order
       FROM requirement_status_mapping
       ORDER BY sort_order ASC, workflow_status ASC`,
    )
    .all()
    .map((row) => ({
      workflowStatus: String(row.workflow_status),
      mapsToActionStatus: /** @type {import('../src/domain/actionItem.js').ActionItemStatus} */ (
        row.maps_to_action_status
      ),
      sortOrder: Number(row.sort_order) || 0,
    }))
}

/**
 * @returns {Map<string, RequirementStatusMappingRow>}
 */
function getStatusMappingMap() {
  const map = new Map()
  for (const row of listStatusMappings()) {
    map.set(row.workflowStatus, row)
  }
  return map
}

/**
 * @param {RequirementStatusMappingRow[]} items
 */
function replaceStatusMappings(items) {
  const db = getDb()
  /** @type {{ row: number; message: string }[]} */
  const errors = []

  const normalized = items.map((item, index) => {
    const workflowStatus = String(item.workflowStatus ?? '').trim()
    const mapsToActionStatus = item.mapsToActionStatus
    if (!workflowStatus) {
      errors.push({ row: index + 1, message: '外部操作状态不能为空' })
      return null
    }
    if (!isActionItemStatus(mapsToActionStatus)) {
      errors.push({ row: index + 1, message: `外部状态 ${workflowStatus} 的映射目标无效` })
      return null
    }
    return {
      workflowStatus,
      mapsToActionStatus,
      sortOrder: Number(item.sortOrder) || index,
    }
  }).filter(Boolean)

  if (errors.length) {
    return { ok: false, errors, items: listStatusMappings() }
  }

  const txn = db.transaction((rows) => {
    db.prepare('DELETE FROM requirement_status_mapping').run()
    const insert = db.prepare(
      `INSERT INTO requirement_status_mapping (workflow_status, maps_to_action_status, sort_order)
       VALUES (?, ?, ?)`,
    )
    for (const row of rows) {
      if (!row) continue
      insert.run(row.workflowStatus, row.mapsToActionStatus, row.sortOrder)
    }
  })

  txn(normalized)
  bumpDataRevision()
  return { ok: true, errors: [], items: listStatusMappings() }
}

export const requirementTicketProgressRepository = {
  listProgress,
  getProgressByTicketIds,
  importProgressRows,
  listStatusMappings,
  getStatusMappingMap,
  replaceStatusMappings,
}
