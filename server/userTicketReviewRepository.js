import { getDb } from './db.js'

/** @typedef {'manual' | 'save'} UserTicketReviewSource */

/**
 * @typedef {Object} UserTicketReviewRow
 * @property {string} userId
 * @property {string} recordId
 * @property {UserTicketReviewSource} source
 * @property {string} markedAt
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {UserTicketReviewRow}
 */
function rowToItem(row) {
  return {
    userId: String(row.user_id || ''),
    recordId: String(row.record_id || ''),
    source: /** @type {UserTicketReviewSource} */ (String(row.source || 'manual')),
    markedAt: String(row.marked_at || ''),
  }
}

export const userTicketReviewRepository = {
  /**
   * @param {string} userId
   * @returns {UserTicketReviewRow[]}
   */
  listByUserId(userId) {
    const db = getDb()
    const rows = db
      .prepare(
        `SELECT user_id, record_id, source, marked_at
         FROM user_ticket_review
         WHERE user_id = ?
         ORDER BY marked_at DESC`,
      )
      .all(userId)
    return rows.map((row) => rowToItem(/** @type {Record<string, unknown>} */ (row)))
  },

  /**
   * @param {string} userId
   * @param {string} recordId
   * @param {UserTicketReviewSource} source
   * @returns {UserTicketReviewRow}
   */
  markDone(userId, recordId, source) {
    const db = getDb()
    const markedAt = new Date().toISOString()
    db.prepare(
      `INSERT INTO user_ticket_review (user_id, record_id, source, marked_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, record_id) DO UPDATE SET
         source = excluded.source,
         marked_at = excluded.marked_at`,
    ).run(userId, recordId, source, markedAt)
    return { userId, recordId, source, markedAt }
  },

  /**
   * @param {string} userId
   * @param {string} recordId
   * @returns {boolean} whether a row was deleted
   */
  unmark(userId, recordId) {
    const db = getDb()
    const result = db
      .prepare('DELETE FROM user_ticket_review WHERE user_id = ? AND record_id = ?')
      .run(userId, recordId)
    return result.changes > 0
  },
}
