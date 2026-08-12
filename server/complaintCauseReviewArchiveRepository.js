import { getDb } from './db.js'

function parseJson(text) {
  return JSON.parse(text)
}

function stringifyJson(value) {
  return JSON.stringify(value)
}

export const complaintCauseReviewArchiveRepository = {
  /**
   * @returns {import('../src/domain/complaintCauseReviewArchive.js').ComplaintCauseReviewArchiveRow[]}
   */
  listAll() {
    const db = getDb()
    const rows = db
      .prepare('SELECT payload FROM complaint_cause_review_archive ORDER BY decided_at DESC')
      .all()
    return rows.map((r) => parseJson(r.payload))
  },

  /**
   * @param {import('../src/domain/complaintCauseReviewArchive.js').ComplaintCauseReviewArchiveRow} row
   */
  insert(row) {
    const db = getDb()
    db.prepare(
      `INSERT INTO complaint_cause_review_archive
        (id, record_id, ticket_id, decision, decided_at, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ).run(
      row.id,
      row.recordId,
      row.ticketId,
      row.decision,
      row.decidedAt,
      stringifyJson(row),
    )
    return row
  },

  /**
   * @param {import('../src/domain/complaintCauseReviewArchive.js').ComplaintCauseReviewArchiveRow[]} rows
   */
  insertMany(rows) {
    const db = getDb()
    const stmt = db.prepare(
      `INSERT INTO complaint_cause_review_archive
        (id, record_id, ticket_id, decision, decided_at, payload)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    const tx = db.transaction((list) => {
      for (const row of list) {
        stmt.run(
          row.id,
          row.recordId,
          row.ticketId,
          row.decision,
          row.decidedAt,
          stringifyJson(row),
        )
      }
    })
    tx(rows)
    return rows
  },
}
