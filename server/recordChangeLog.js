import { getDb } from './db.js'

const MAX_CHANGE_PAGE = 1000
const RETAINED_CHANGES = 100000

/** SQLite triggers append one entry in the same transaction as each records mutation. */
export function getRecordChangeCursor() {
  return getDb().prepare('SELECT COALESCE(MAX(seq), 0) AS cursor FROM record_changes').get().cursor
}

/**
 * @param {number} after
 * @param {number} through
 * @param {number} [limit]
 */
export function listRecordChanges(after, through, limit = MAX_CHANGE_PAGE) {
  const db = getDb()
  const oldest = db.prepare('SELECT MIN(seq) AS seq FROM record_changes').get().seq
  const latest = getRecordChangeCursor()
  const upper = Math.min(Math.max(0, Math.floor(through)), latest)
  if (oldest != null && after < oldest - 1) {
    return { resetRequired: true, changes: [], cursor: after, through: upper, hasMore: false }
  }
  const pageSize = Math.min(MAX_CHANGE_PAGE, Math.max(1, Math.floor(limit) || MAX_CHANGE_PAGE))
  const rows = db.prepare(`
    SELECT seq, record_id AS id, old_source_type AS oldSourceType,
      new_source_type AS newSourceType, old_import_month AS oldImportMonth,
      new_import_month AS newImportMonth
    FROM record_changes WHERE seq > ? AND seq <= ? ORDER BY seq LIMIT ?
  `).all(after, upper, pageSize)
  const cursor = rows.length ? rows[rows.length - 1].seq : upper
  return {
    resetRequired: false,
    changes: rows,
    cursor,
    through: upper,
    hasMore: cursor < upper,
  }
}

/** Keep a bounded recovery window; clients older than the window do one full resync. */
export function pruneRecordChanges() {
  const cutoff = getRecordChangeCursor() - RETAINED_CHANGES
  if (cutoff <= 0) return 0
  return getDb().prepare('DELETE FROM record_changes WHERE seq <= ?').run(cutoff).changes
}
