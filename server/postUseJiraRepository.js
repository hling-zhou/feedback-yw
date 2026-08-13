import { randomId } from '../src/lib/randomId.js'
import {
  POST_USE_JIRA_DEFAULT_STATUS,
  isPostUseJiraStatus,
  normalizePostUseJiraStatus,
  pickPostUseJiraEditablePatch,
} from '../src/domain/postUseJira.js'
import { bumpDataRevision } from './dataRevision.js'
import { getDb } from './db.js'

function parseJson(text) {
  return JSON.parse(text)
}

function stringifyJson(value) {
  return JSON.stringify(value)
}

function nowIso() {
  return new Date().toISOString()
}

function normalizeItemKey(value) {
  return String(value || '').trim()
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeDecision(raw) {
  const itemKey = normalizeItemKey(raw?.itemKey || raw?.item_key)
  return {
    itemKey,
    sourceType: String(raw?.sourceType || '').trim() || 'questionnaire',
    needCustomerVisit: Boolean(raw?.needCustomerVisit),
    needInternalTrace: Boolean(raw?.needInternalTrace),
    updatedAt: String(raw?.updatedAt || '') || nowIso(),
  }
}

/**
 * @param {Record<string, unknown>} raw
 */
export function normalizeJiraItem(raw) {
  const itemKey = normalizeItemKey(raw?.itemKey || raw?.item_key)
  const status = isPostUseJiraStatus(raw?.status)
    ? raw.status
    : normalizePostUseJiraStatus(raw?.status)
  return {
    id: String(raw?.id || '').trim() || randomId(),
    itemKey,
    sourceType: String(raw?.sourceType || '').trim() || 'questionnaire',
    importMonth: String(raw?.importMonth || '').trim(),
    customerName: String(raw?.customerName || '').trim(),
    customerCode: String(raw?.customerCode || '').trim(),
    productName: String(raw?.productName || '').trim(),
    customerFeedback: String(raw?.customerFeedback || '').trim(),
    jiraTicket: String(raw?.jiraTicket || '').trim(),
    status,
    progress: String(raw?.progress || '').trim(),
    createdAt: String(raw?.createdAt || '') || nowIso(),
    updatedAt: String(raw?.updatedAt || '') || nowIso(),
  }
}

export const postUseCallbackDecisionRepository = {
  list() {
    const rows = getDb().prepare('SELECT payload FROM post_use_callback_decisions').all()
    return rows.map((row) => normalizeDecision(parseJson(row.payload)))
  },

  /**
   * @param {Array<Record<string, unknown>>} items
   */
  upsertMany(items) {
    const stmt = getDb().prepare(
      `INSERT INTO post_use_callback_decisions (item_key, payload)
       VALUES (?, ?)
       ON CONFLICT(item_key) DO UPDATE SET payload = excluded.payload`,
    )
    const updatedAt = nowIso()
    const saved = []
    const tx = getDb().transaction((list) => {
      for (const raw of list) {
        const next = normalizeDecision({ ...raw, updatedAt })
        if (!next.itemKey) continue
        stmt.run(next.itemKey, stringifyJson(next))
        saved.push(next)
      }
    })
    tx(items || [])
    if (saved.length) bumpDataRevision()
    return saved
  },
}

export const postUseJiraRepository = {
  /**
   * @param {{
   *   importMonth?: string
   *   productName?: string
   *   status?: string
   *   search?: string
   *   limit?: number
   *   offset?: number
   * }} [query]
   */
  list(query = {}) {
    const rows = getDb()
      .prepare('SELECT payload FROM post_use_jira_items ORDER BY updated_at DESC, id DESC')
      .all()
      .map((row) => normalizeJiraItem(parseJson(row.payload)))

    const importMonth = String(query.importMonth || '').trim()
    const productName = String(query.productName || '').trim()
    const status = String(query.status || '').trim()
    const search = String(query.search || '').trim().toLowerCase()

    const filtered = rows.filter((item) => {
      if (importMonth && !String(item.importMonth || '').includes(importMonth)) return false
      if (productName && item.productName !== productName) return false
      if (status && item.status !== status) return false
      if (search) {
        const haystack = [item.customerName, item.customerCode, item.jiraTicket, item.customerFeedback]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    const limit = Math.min(500, Math.max(1, Number(query.limit) || 100))
    const offset = Math.max(0, Number(query.offset) || 0)
    return {
      items: filtered.slice(offset, offset + limit),
      total: filtered.length,
      limit,
      offset,
    }
  },

  getById(id) {
    const row = getDb().prepare('SELECT payload FROM post_use_jira_items WHERE id = ?').get(id)
    return row ? normalizeJiraItem(parseJson(row.payload)) : null
  },

  getByItemKey(itemKey) {
    const row = getDb()
      .prepare('SELECT payload FROM post_use_jira_items WHERE item_key = ?')
      .get(itemKey)
    return row ? normalizeJiraItem(parseJson(row.payload)) : null
  },

  /**
   * @param {Array<Record<string, unknown>>} items
   */
  archiveMany(items) {
    const insert = getDb().prepare(
      `INSERT INTO post_use_jira_items
        (id, item_key, import_month, customer_name, customer_code, product_name, status, updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const update = getDb().prepare(
      `UPDATE post_use_jira_items
       SET import_month = ?, customer_name = ?, customer_code = ?, product_name = ?, updated_at = ?, payload = ?
       WHERE item_key = ?`,
    )
    const lookup = (itemKey) => postUseJiraRepository.getByItemKey(itemKey)
    const saved = []
    const tx = getDb().transaction((list) => {
      for (const raw of list) {
        const incoming = normalizeJiraItem(raw)
        if (!incoming.itemKey) continue
        const existing = lookup(incoming.itemKey)
        const next = existing
          ? {
              ...existing,
              importMonth: incoming.importMonth || existing.importMonth,
              customerName: incoming.customerName || existing.customerName,
              customerCode: incoming.customerCode || existing.customerCode,
              productName: incoming.productName || existing.productName,
              customerFeedback: incoming.customerFeedback || existing.customerFeedback,
              sourceType: incoming.sourceType || existing.sourceType,
              updatedAt: nowIso(),
            }
          : {
              ...incoming,
              status: POST_USE_JIRA_DEFAULT_STATUS,
              jiraTicket: incoming.jiraTicket || '',
              progress: incoming.progress || '',
              createdAt: nowIso(),
              updatedAt: nowIso(),
            }
        if (existing) {
          update.run(
            next.importMonth,
            next.customerName,
            next.customerCode,
            next.productName,
            next.updatedAt,
            stringifyJson(next),
            next.itemKey,
          )
        } else {
          insert.run(
            next.id,
            next.itemKey,
            next.importMonth,
            next.customerName,
            next.customerCode,
            next.productName,
            next.status,
            next.updatedAt,
            stringifyJson(next),
          )
        }
        saved.push(next)
      }
    })
    tx(items || [])
    if (saved.length) bumpDataRevision()
    return saved
  },

  /**
   * @param {string} id
   * @param {Record<string, unknown>} patch
   */
  patch(id, patch) {
    const existing = this.getById(id)
    if (!existing) return null
    const editable = pickPostUseJiraEditablePatch(patch)
    const next = {
      ...existing,
      ...editable,
      updatedAt: nowIso(),
    }
    getDb()
      .prepare(
        `UPDATE post_use_jira_items
         SET status = ?, updated_at = ?, payload = ?
         WHERE id = ?`,
      )
      .run(next.status, next.updatedAt, stringifyJson(next), id)
    bumpDataRevision()
    return next
  },

  delete(id) {
    const result = getDb().prepare('DELETE FROM post_use_jira_items WHERE id = ?').run(id)
    if (result.changes) bumpDataRevision()
    return result.changes > 0
  },

  /**
   * @param {string[]} ids
   */
  deleteMany(ids) {
    const stmt = getDb().prepare('DELETE FROM post_use_jira_items WHERE id = ?')
    let deleted = 0
    const tx = getDb().transaction((list) => {
      for (const id of list) {
        const result = stmt.run(String(id || '').trim())
        deleted += result.changes
      }
    })
    tx((ids || []).filter(Boolean))
    if (deleted) bumpDataRevision()
    return deleted
  },
}
