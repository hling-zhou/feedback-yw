import { randomUUID } from 'node:crypto'
import { getDb } from './db.js'
import { MESSAGE_BOTTLE_DEFAULT_PROGRESS } from '../src/domain/messageBottle.js'

/**
 * @typedef {import('../src/domain/messageBottle.js').MessageBottleAttachment} MessageBottleAttachment
 */

/**
 * @typedef {Object} MessageBottleRecord
 * @property {string} id
 * @property {string} userId
 * @property {string} username
 * @property {string} content
 * @property {MessageBottleAttachment[]} attachments
 * @property {string} progress
 * @property {string} createdAt
 * @property {string} updatedAt
 */

/**
 * @param {import('better-sqlite3').Database} db
 * @param {string} id
 */
function getById(db, id) {
  const row = db.prepare('SELECT * FROM message_bottles WHERE id = ?').get(id)
  return row ? rowToRecord(row) : null
}

/**
 * @param {Record<string, unknown>} row
 * @returns {MessageBottleRecord}
 */
function rowToRecord(row) {
  /** @type {MessageBottleAttachment[]} */
  let attachments = []
  if (row.attachments_json) {
    try {
      const parsed = JSON.parse(String(row.attachments_json))
      attachments = Array.isArray(parsed) ? parsed : []
    } catch {
      attachments = []
    }
  }
  return {
    id: String(row.id),
    userId: String(row.user_id || ''),
    username: String(row.username || ''),
    content: String(row.content || ''),
    attachments,
    progress: String(row.progress || MESSAGE_BOTTLE_DEFAULT_PROGRESS),
    createdAt: String(row.created_at || ''),
    updatedAt: String(row.updated_at || ''),
  }
}

export const messageBottleRepository = {
  /**
   * @param {{ userId: string; username: string; content: string; attachments?: MessageBottleAttachment[] }} input
   */
  create(input) {
    const db = getDb()
    const now = new Date().toISOString()
    const record = {
      id: randomUUID(),
      userId: input.userId,
      username: input.username,
      content: input.content.trim(),
      attachments: input.attachments || [],
      progress: MESSAGE_BOTTLE_DEFAULT_PROGRESS,
      createdAt: now,
      updatedAt: now,
    }
    db.prepare(
      `INSERT INTO message_bottles (
        id, user_id, username, content, attachments_json, progress, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      record.id,
      record.userId,
      record.username,
      record.content,
      JSON.stringify(record.attachments),
      record.progress,
      record.createdAt,
      record.updatedAt,
    )
    return record
  },

  /**
   * @param {{ limit?: number; offset?: number }} [query]
   * @returns {{ items: MessageBottleRecord[]; total: number }}
   */
  list(query = {}) {
    const db = getDb()
    const limit = Math.min(Math.max(Number(query.limit) || 100, 1), 500)
    const offset = Math.max(Number(query.offset) || 0, 0)
    const totalRow = db.prepare('SELECT COUNT(*) AS count FROM message_bottles').get()
    const total = Number(totalRow?.count || 0)
    const rows = db
      .prepare(
        `SELECT * FROM message_bottles
         ORDER BY datetime(created_at) DESC
         LIMIT ? OFFSET ?`,
      )
      .all(limit, offset)
    return {
      items: rows.map(rowToRecord),
      total,
      limit,
      offset,
    }
  },

  /**
   * @param {string} id
   * @param {string} progress
   */
  updateProgress(id, progress) {
    const db = getDb()
    const existing = getById(db, id)
    if (!existing) return null
    const nextProgress = progress.trim()
    const updatedAt = new Date().toISOString()
    db.prepare('UPDATE message_bottles SET progress = ?, updated_at = ? WHERE id = ?').run(
      nextProgress,
      updatedAt,
      id,
    )
    return { ...existing, progress: nextProgress, updatedAt }
  },
}
