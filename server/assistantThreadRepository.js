/**
 * AI 助手会话存储：按用户隔离的线程与消息。
 *
 * 只存用户看得到的问句和答案；工具循环中的检索原文、快照全文不写入。
 * 引用只存 recordId/ticketId/来源/字段名，打开会话时按当前记录回填片段。
 */

import { randomId } from '../src/lib/randomId.js'
import { getDb } from './db.js'

const MAX_THREADS_PER_USER = 20
const TITLE_MAX_LENGTH = 40

function nowIso() {
  return new Date().toISOString()
}

function parseJson(text) {
  return JSON.parse(text)
}

function stringifyJson(value) {
  return JSON.stringify(value)
}

/**
 * 截断线程标题。
 * @param {string} text
 * @returns {string}
 */
function truncateTitle(text) {
  const s = String(text || '').trim()
  if (!s) return '新对话'
  return s.length > TITLE_MAX_LENGTH ? `${s.slice(0, TITLE_MAX_LENGTH)}…` : s
}

/**
 * @typedef {Object} AssistantThread
 * @property {string} id
 * @property {string} userId
 * @property {string} title
 * @property {string} updatedAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AssistantMessage
 * @property {string} id
 * @property {string} threadId
 * @property {'user' | 'assistant'} role
 * @property {Record<string, unknown>} payload
 * @property {string} createdAt
 */

export const assistantThreadRepository = {
  /**
   * 列出当前用户最近 20 条线程。
   * @param {string} userId
   * @returns {AssistantThread[]}
   */
  listThreads(userId) {
    const uid = String(userId || '').trim()
    if (!uid) return []
    const rows = getDb()
      .prepare(
        `SELECT id, user_id, title, updated_at, created_at
         FROM assistant_threads
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT ?`,
      )
      .all(uid, MAX_THREADS_PER_USER)
    return rows.map((r) => ({
      id: r.id,
      userId: r.user_id,
      title: r.title,
      updatedAt: r.updated_at,
      createdAt: r.created_at,
    }))
  },

  /**
   * 取一条线程（必须属于该用户）。
   * @param {string} userId
   * @param {string} threadId
   * @returns {AssistantThread | null}
   */
  getThread(userId, threadId) {
    const uid = String(userId || '').trim()
    const tid = String(threadId || '').trim()
    if (!uid || !tid) return null
    const row = getDb()
      .prepare('SELECT id, user_id, title, updated_at, created_at FROM assistant_threads WHERE id = ? AND user_id = ?')
      .get(tid, uid)
    if (!row) return null
    return {
      id: row.id,
      userId: row.user_id,
      title: row.title,
      updatedAt: row.updated_at,
      createdAt: row.created_at,
    }
  },

  /**
   * 新建线程，并裁剪该用户超出上限的最旧线程。
   * @param {string} userId
   * @param {string} [title]
   * @returns {AssistantThread}
   */
  createThread(userId, title) {
    const uid = String(userId || '').trim()
    if (!uid) throw new Error('缺少用户')
    const id = randomId()
    const ts = nowIso()
    const thread = {
      id,
      userId: uid,
      title: truncateTitle(title || '新对话'),
      updatedAt: ts,
      createdAt: ts,
    }
    const db = getDb()
    db.prepare(
      `INSERT INTO assistant_threads (id, user_id, title, updated_at, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(thread.id, thread.userId, thread.title, thread.updatedAt, thread.createdAt)

    // 裁剪超出上限的最旧线程
    const overflow = db
      .prepare(
        `SELECT id FROM assistant_threads
         WHERE user_id = ?
         ORDER BY updated_at DESC
         LIMIT -1 OFFSET ?`,
      )
      .all(uid, MAX_THREADS_PER_USER)
    for (const row of overflow) {
      db.prepare('DELETE FROM assistant_messages WHERE thread_id = ?').run(row.id)
      db.prepare('DELETE FROM assistant_threads WHERE id = ?').run(row.id)
    }
    return thread
  },

  /**
   * 删除线程（必须属于该用户）。
   * @param {string} userId
   * @param {string} threadId
   * @returns {boolean}
   */
  deleteThread(userId, threadId) {
    const uid = String(userId || '').trim()
    const tid = String(threadId || '').trim()
    if (!uid || !tid) return false
    const db = getDb()
    const existing = db
      .prepare('SELECT id FROM assistant_threads WHERE id = ? AND user_id = ?')
      .get(tid, uid)
    if (!existing) return false
    db.prepare('DELETE FROM assistant_messages WHERE thread_id = ?').run(tid)
    db.prepare('DELETE FROM assistant_threads WHERE id = ?').run(tid)
    return true
  },

  /**
   * 列出线程的消息（按时间升序）。
   * @param {string} userId
   * @param {string} threadId
   * @returns {AssistantMessage[]}
   */
  listMessages(userId, threadId) {
    const uid = String(userId || '').trim()
    const tid = String(threadId || '').trim()
    if (!uid || !tid) return []
    // 先确认线程归属，避免越权读取
    const owned = getDb()
      .prepare('SELECT id FROM assistant_threads WHERE id = ? AND user_id = ?')
      .get(tid, uid)
    if (!owned) return []
    const rows = getDb()
      .prepare(
        `SELECT id, thread_id, role, payload, created_at
         FROM assistant_messages
         WHERE thread_id = ?
         ORDER BY created_at ASC`,
      )
      .all(tid)
    return rows.map((r) => ({
      id: r.id,
      threadId: r.thread_id,
      role: r.role,
      payload: parseJson(r.payload),
      createdAt: r.created_at,
    }))
  },

  /**
   * 追加一条消息并刷新线程 updated_at。
   * @param {string} threadId
   * @param {'user' | 'assistant'} role
   * @param {Record<string, unknown>} payload
   * @returns {AssistantMessage}
   */
  appendMessage(threadId, role, payload) {
    const tid = String(threadId || '').trim()
    if (!tid) throw new Error('缺少线程 id')
    const id = randomId()
    const ts = nowIso()
    const db = getDb()
    db.prepare(
      `INSERT INTO assistant_messages (id, thread_id, role, payload, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    ).run(id, tid, role, stringifyJson(payload ?? {}), ts)
    db.prepare('UPDATE assistant_threads SET updated_at = ? WHERE id = ?').run(ts, tid)
    return { id, threadId: tid, role, payload: payload ?? {}, createdAt: ts }
  },

  /**
   * 同一事务写入用户消息和助手消息；失败则两边都不落库。
   * @param {string} threadId
   * @param {Record<string, unknown>} userPayload
   * @param {Record<string, unknown>} assistantPayload
   * @param {string} [title] 首问时更新标题
   * @returns {{ user: AssistantMessage; assistant: AssistantMessage }}
   */
  appendTurn(threadId, userPayload, assistantPayload, title) {
    const tid = String(threadId || '').trim()
    if (!tid) throw new Error('缺少线程 id')
    const db = getDb()
    const write = db.transaction(() => {
      const user = this.appendMessage(tid, 'user', userPayload)
      const assistant = this.appendMessage(tid, 'assistant', assistantPayload)
      if (title) {
        db.prepare('UPDATE assistant_threads SET title = ?, updated_at = ? WHERE id = ?').run(
          truncateTitle(title),
          nowIso(),
          tid,
        )
      }
      return { user, assistant }
    })
    return write()
  },

  /**
   * 更新线程标题（首问截断）。
   * @param {string} threadId
   * @param {string} title
   */
  renameThread(threadId, title) {
    const tid = String(threadId || '').trim()
    if (!tid) return
    getDb()
      .prepare('UPDATE assistant_threads SET title = ?, updated_at = ? WHERE id = ?')
      .run(truncateTitle(title), nowIso(), tid)
  },

  /**
   * 删除某用户的全部线程与消息（删除账号时级联）。
   * @param {string} userId
   */
  deleteAllForUser(userId) {
    const uid = String(userId || '').trim()
    if (!uid) return
    const db = getDb()
    const threadIds = db
      .prepare('SELECT id FROM assistant_threads WHERE user_id = ?')
      .all(uid)
      .map((r) => r.id)
    if (!threadIds.length) return
    const placeholders = threadIds.map(() => '?').join(',')
    db.prepare(`DELETE FROM assistant_messages WHERE thread_id IN (${placeholders})`).run(...threadIds)
    db.prepare('DELETE FROM assistant_threads WHERE user_id = ?').run(uid)
  },
}
