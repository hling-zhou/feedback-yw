import { randomId } from '../src/lib/randomId.js'
import { getDb } from './db.js'

/** @typedef {{
 *   id: string
 *   userId: string | null
 *   username: string
 *   action: string
 *   detail: Record<string, unknown>
 *   createdAt: string
 * }} AuditEntry */

/**
 * @param {import('fastify').FastifyRequest | null} request
 * @param {string} action
 * @param {Record<string, unknown>} [detail]
 */
export function logAuditFromRequest(request, action, detail = {}) {
  const user = request?.user
  const apiKey = request?.apiKey
  logAudit({
    userId: user?.id ?? apiKey?.createdByUserId ?? null,
    username: user?.username ?? (apiKey ? `apikey:${apiKey.name}` : 'system'),
    action,
    detail: apiKey
      ? { ...detail, apiKeyId: apiKey.id, apiKeyName: apiKey.name }
      : detail,
  })
}

/**
 * @param {{
 *   userId?: string | null
 *   username: string
 *   action: string
 *   detail?: Record<string, unknown>
 * }} entry
 */
export function logAudit(entry) {
  const db = getDb()
  const id = randomId()
  const createdAt = new Date().toISOString()
  db.prepare(
    `INSERT INTO audit_log (id, user_id, username, action, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    entry.userId ?? null,
    entry.username,
    entry.action,
    JSON.stringify(entry.detail ?? {}),
    createdAt,
  )
}

const AUDIT_DEFAULT_DAYS = 7
const AUDIT_MAX_DAYS = 90
/** 单日上限内的安全行数上限，防止异常流量撑爆响应 */
const AUDIT_MAX_ROWS = 5000

/**
 * @param {number} [days] 最近 N 天（含今天），默认 7
 * @returns {AuditEntry[]}
 */
export function listAuditLogs(days = AUDIT_DEFAULT_DAYS) {
  const db = getDb()
  const dayCount = Math.min(
    Math.max(1, Math.floor(days || AUDIT_DEFAULT_DAYS)),
    AUDIT_MAX_DAYS,
  )
  const since = new Date(Date.now() - dayCount * 24 * 60 * 60 * 1000).toISOString()
  const rows = db
    .prepare(
      `SELECT id, user_id, username, action, detail_json, created_at
       FROM audit_log
       WHERE created_at >= ?
       ORDER BY created_at DESC
       LIMIT ?`,
    )
    .all(since, AUDIT_MAX_ROWS)

  return rows.map((row) => {
    let detail = {}
    try {
      detail = JSON.parse(row.detail_json || '{}')
    } catch {
      detail = { raw: row.detail_json }
    }
    return {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      action: row.action,
      detail,
      createdAt: row.created_at,
    }
  })
}
