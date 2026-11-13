import { randomId } from '../src/lib/randomId.js'
import {
  POST_USE_JIRA_DEFAULT_STATUS,
  isPostUseJiraStatus,
  normalizePostUseJiraStatus,
  pickPostUseJiraEditablePatch,
} from '../src/domain/postUseJira.js'
import { bumpDataRevision } from './dataRevision.js'
import { getDb } from './db.js'
import { normalizePostUseActionIds, withPostUseActionIds } from '../src/domain/postUseActions.js'

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
  const actionIds = normalizePostUseActionIds(raw?.actionIds, raw?.actionId)
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
    loginAccountName: String(raw?.loginAccountName || '').trim(),
    productName: String(raw?.productName || '').trim(),
    customerFeedback: String(raw?.customerFeedback || '').trim(),
    recommendedReason: String(raw?.recommendedReason || '').trim(),
    originalTicketId: String(raw?.originalTicketId || '').trim(),
    scoreSource: String(raw?.scoreSource || '').trim(),
    jiraTicket: String(raw?.jiraTicket || '').trim(),
    status,
    progress: String(raw?.progress || '').trim(),
    progressEditMeta: raw?.progressEditMeta && typeof raw.progressEditMeta === 'object'
      ? {
          userId: String(raw.progressEditMeta.userId || ''),
          username: String(raw.progressEditMeta.username || ''),
          displayName: String(raw.progressEditMeta.displayName || ''),
          editedAt: String(raw.progressEditMeta.editedAt || ''),
        }
      : null,
    assigneeId: String(raw?.assigneeId || '').trim(),
    assigneeName: String(raw?.assigneeName || '').trim(),
    actionIds,
    actionId: actionIds[0] || '',
    actionLinksEditMeta: raw?.actionLinksEditMeta || null,
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

    // importMonth 可能是「、」分隔多月份文本；查询侧也支持传多月份（、分隔），任一命中即可
    const importMonths = String(query.importMonth || '')
      .split('、')
      .map((m) => m.trim())
      .filter(Boolean)
    const productName = String(query.productName || '').trim()
    const status = String(query.status || '').trim()
    const assigneeId = String(query.assigneeId || '').trim()
    const actionId = String(query.actionId || '').trim()
    const search = String(query.search || '').trim().toLowerCase()

    const filtered = rows.filter((item) => {
      if (importMonths.length) {
        const itemMonths = String(item.importMonth || '')
          .split('、')
          .map((m) => m.trim())
          .filter(Boolean)
        if (!importMonths.some((m) => itemMonths.includes(m))) return false
      }
      if (productName && item.productName !== productName) return false
      if (status && item.status !== status) return false
      if (assigneeId && item.assigneeId !== assigneeId) return false
      if (actionId && !item.actionIds.includes(actionId)) return false
      if (search) {
        const haystack = [item.customerName, item.customerCode, item.jiraTicket, item.customerFeedback, item.assigneeName]
          .join(' ')
          .toLowerCase()
        if (!haystack.includes(search)) return false
      }
      return true
    })

    // limit <= 0 表示不分页（返回全量，供需要内存二次过滤的调用方使用）
    const parsedLimit = Number(query.limit)
    const rawLimit = query.limit == null || !Number.isFinite(parsedLimit) ? 100 : parsedLimit
    const limit = rawLimit <= 0 ? filtered.length : Math.min(500, Math.max(1, rawLimit))
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
        (id, item_key, import_month, customer_name, customer_code, product_name, status, assignee_id, assignee_name, updated_at, payload)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    const update = getDb().prepare(
      `UPDATE post_use_jira_items
       SET import_month = ?, customer_name = ?, customer_code = ?, product_name = ?, assignee_id = ?, assignee_name = ?, updated_at = ?, payload = ?
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
              loginAccountName: incoming.loginAccountName || existing.loginAccountName,
              productName: incoming.productName || existing.productName,
              customerFeedback: incoming.customerFeedback || existing.customerFeedback,
              recommendedReason: incoming.recommendedReason || existing.recommendedReason,
              originalTicketId: incoming.originalTicketId || existing.originalTicketId,
              scoreSource: incoming.scoreSource || existing.scoreSource,
              sourceType: incoming.sourceType || existing.sourceType,
              assigneeId: incoming.assigneeId || existing.assigneeId,
              assigneeName: incoming.assigneeName || existing.assigneeName,
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
            next.assigneeId,
            next.assigneeName,
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
            next.assigneeId,
            next.assigneeName,
            next.updatedAt,
            stringifyJson(next),
          )
        }
        saved.push(next)
      }
    })
    tx(items || [])
    // 2026-11-09 归档即清勾选（用户拍板）：归档=这条溯源处理完结，decisions 的 needInternalTrace
    // 联动退场（复用删除联动 clearTraceDecisionsForDeletedItem 的前缀+月份包含判定）。
    // 在归档事务外逐条调用——其内部自带事务，嵌套会死锁。
    for (const item of saved) this.clearTraceDecisionsForDeletedItem(item.itemKey)
    if (saved.length) bumpDataRevision()
    return saved
  },

  /**
   * @param {string} id
   * @param {Record<string, unknown>} patch
   * @param {{ id: string, username: string, displayName?: string }} [editor]
   */
  patch(id, patch, editor) {
    const existing = this.getById(id)
    if (!existing) return null
    const editable = pickPostUseJiraEditablePatch(patch)
    const next = {
      ...existing,
      ...editable,
      updatedAt: nowIso(),
    }
    if (Object.prototype.hasOwnProperty.call(editable, 'actionId')) {
      const replacement = String(editable.actionId || '').trim()
      const actionIds = replacement
        ? [replacement, ...existing.actionIds.slice(1).filter((id) => id !== replacement)]
        : existing.actionIds.slice(1)
      Object.assign(next, withPostUseActionIds(next, actionIds))
      if (editor?.id && actionIds.join('\0') !== existing.actionIds.join('\0')) {
        next.actionLinksEditMeta = {
          userId: editor.id,
          username: editor.username,
          displayName: editor.displayName || '',
          editedAt: next.updatedAt,
        }
      }
    }
    if (Object.prototype.hasOwnProperty.call(editable, 'progress')
      && editable.progress !== existing.progress && editor?.id) {
      next.progressEditMeta = {
        userId: editor.id,
        username: editor.username,
        displayName: editor.displayName || '',
        editedAt: next.updatedAt,
      }
    }
    getDb()
      .prepare(
        `UPDATE post_use_jira_items
         SET status = ?, assignee_id = ?, assignee_name = ?, updated_at = ?, payload = ?
         WHERE id = ?`,
      )
      .run(next.status, next.assigneeId, next.assigneeName, next.updatedAt, stringifyJson(next), id)
    bumpDataRevision()
    return next
  },

  /**
   * 以增量方式保存关联，避免两个抽屉用旧快照互相覆盖。
   * @param {string} id
   * @param {string} actionId
   * @param {'add'|'remove'} operation
   * @param {{ id: string, username: string, displayName?: string }} editor
   */
  updateActionLink(id, actionId, operation, editor) {
    const db = getDb()
    let changed = false
    const item = db.transaction(() => {
      const existing = this.getById(id)
      if (!existing) return null
      const current = existing.actionIds
      const nextIds = operation === 'add'
        ? current.includes(actionId) ? current : [...current, actionId]
        : current.filter((value) => value !== actionId)
      if (nextIds.length === current.length) return existing
      changed = true
      const updatedAt = nowIso()
      const next = {
        ...withPostUseActionIds(existing, nextIds),
        updatedAt,
        actionLinksEditMeta: {
          userId: editor.id,
          username: editor.username,
          displayName: editor.displayName || '',
          editedAt: updatedAt,
        },
      }
      db.prepare('UPDATE post_use_jira_items SET updated_at = ?, payload = ? WHERE id = ?')
        .run(updatedAt, stringifyJson(next), id)
      return next
    })()
    if (changed) bumpDataRevision()
    return item
  },

  /**
   * 2026-11-06 #6（用户拍板）：删除产品部回溯归档条目时联动取消清单勾选——
   * 被删条目的 itemKey 在 post_use_callback_decisions 中的 needInternalTrace 置 false
   * （needCustomerVisit 是省代表回访维度，归档删除不动它）。
   * 覆盖周期包含语义：勾选存储键的月份段可能 ⊄ 被删归档键月份段（如月键勾选 + 季度键归档），
   * 无法靠纯 SQL 精确圈定——取「归档键前缀（q:客户:产品）」相同的全部决策键，逐条拆月判定：
   * 存储键月份集合 ⊆ 被删键月份集合 的才取消（与前端 itemKeySubsetMatches 同语义）。
   * @param {string} deletedItemKey 被删除的归档条目键
   * @returns {number} 清除勾选的决策条数
   */
  clearTraceDecisionsForDeletedItem(deletedItemKey) {
    const key = normalizeItemKey(deletedItemKey)
    if (!key) return 0
    const prefix = extractItemKeyPrefix(key)
    if (!prefix) return 0
    const rows = getDb()
      .prepare(`SELECT item_key, payload FROM post_use_callback_decisions WHERE item_key LIKE ?`)
      .all(`${prefix}%`)
    let cleared = 0
    const tx = getDb().transaction(() => {
      for (const row of rows) {
        const decision = normalizeDecision(parseJson(row.payload))
        if (!decision.needInternalTrace) continue
        // 前缀相同 + 存储键月份 ⊆ 被删键月份（或存储键无月份段=旧格式兜底）才取消
        const storedMonths = extractItemKeyMonths(row.item_key)
        const deletedMonths = extractItemKeyMonths(key)
        if (storedMonths.length && deletedMonths.length && !storedMonths.every((m) => deletedMonths.includes(m))) {
          continue
        }
        const next = { ...decision, needInternalTrace: false, updatedAt: nowIso() }
        getDb()
          .prepare(`UPDATE post_use_callback_decisions SET payload = ? WHERE item_key = ?`)
          .run(stringifyJson(next), row.item_key)
        cleared += 1
      }
    })
    tx()
    if (cleared) bumpDataRevision()
    return cleared
  },

  delete(id) {
    // #6：先取被删条目的 itemKey，删除后联动取消勾选（不因删除失败误清）
    const existing = this.getById(id)
    const result = getDb().prepare('DELETE FROM post_use_jira_items WHERE id = ?').run(id)
    if (result.changes) {
      if (existing?.itemKey) this.clearTraceDecisionsForDeletedItem(existing.itemKey)
      bumpDataRevision()
    }
    return result.changes > 0
  },

  /**
   * @param {string[]} ids
   */
  deleteMany(ids) {
    const stmt = getDb().prepare('DELETE FROM post_use_jira_items WHERE id = ?')
    /** @type {string[]} */
    const deletedItemKeys = []
    let deleted = 0
    const tx = getDb().transaction((list) => {
      for (const id of list) {
        const row = getDb().prepare('SELECT payload FROM post_use_jira_items WHERE id = ?').get(id)
        const result = stmt.run(String(id || '').trim())
        if (result.changes) {
          deleted += result.changes
          if (row) {
            const item = normalizeJiraItem(parseJson(row.payload))
            if (item.itemKey) deletedItemKeys.push(item.itemKey)
          }
        }
      }
    })
    tx((ids || []).filter(Boolean))
    // #6：事务外联动取消勾选（每条独立调用，内部自带事务）
    for (const itemKey of deletedItemKeys) this.clearTraceDecisionsForDeletedItem(itemKey)
    if (deleted) bumpDataRevision()
    return deleted
  },

  /**
   * 2026-11-10 需求③（用户拍板）：删除省代表回访记录 → 联动重置建议回访清单勾选。
   * 按被删回访的身份三元组（月+产品+客户）拼出 q: 前缀，把同前缀且月份包含的决策
   * needCustomerVisit 置 false（清单恢复未勾选态）。判定模式与 clearTraceDecisionsForDeletedItem
   * 同款（前缀相同 + 存储键月份 ⊆ 被删月份，或存储键无月份段=旧格式兜底）。
   * @param {{ month: string, productName: string, customerCode?: string, customerName?: string }} identity
   * @returns {number} 重置勾选的决策条数
   */
  clearVisitDecisionsForDeletedVisit(identity) {
    const month = String(identity?.month || '').trim()
    const productName = String(identity?.productName || '').trim()
    const customerCode = String(identity?.customerCode || '').trim()
    const customerName = String(identity?.customerName || '').trim()
    const customer = customerCode || customerName
    if (!month || !productName || !customer) return 0
    const prefix = `q:${customer}:${productName}`
    const rows = getDb()
      .prepare(`SELECT item_key, payload FROM post_use_callback_decisions WHERE item_key LIKE ?`)
      .all(`${prefix}%`)
    let cleared = 0
    const tx = getDb().transaction(() => {
      for (const row of rows) {
        const decision = normalizeDecision(parseJson(row.payload))
        if (!decision.needCustomerVisit) continue
        const storedMonths = extractItemKeyMonths(row.item_key)
        // 存储键月份须含被删回访月份（该月勾选因这条回访存在；含=重置，不含=其他月份的勾选不动）
        if (storedMonths.length && !storedMonths.includes(month)) continue
        const next = { ...decision, needCustomerVisit: false, updatedAt: nowIso() }
        getDb()
          .prepare(`UPDATE post_use_callback_decisions SET payload = ? WHERE item_key = ?`)
          .run(stringifyJson(next), row.item_key)
        cleared += 1
      }
    })
    tx()
    if (cleared) bumpDataRevision()
    return cleared
  },
}

/**
 * 从 itemKey 提取非月份前缀（q:客户:产品:月份 → q:客户:产品；无月份段则原样）。
 * @param {string} itemKey
 * @returns {string}
 */
function extractItemKeyPrefix(itemKey) {
  const key = String(itemKey || '')
  const m = key.match(/^(q:[^:]+:.+?):(?:\d{4}-\d{2})(?:\|\d{4}-\d{2})*$/)
  if (m) return m[1]
  return /^(q:[^:]+:.+?)$/.test(key) ? key : ''
}

/**
 * 从 itemKey 提取月份段数组（无月份段返回空数组）。
 * @param {string} itemKey
 * @returns {string[]}
 */
function extractItemKeyMonths(itemKey) {
  const key = String(itemKey || '')
  const m = key.match(/^q:[^:]+:.+?:((?:\d{4}-\d{2})(?:\|\d{4}-\d{2})*)$/)
  if (!m) return []
  return m[1].split('|')
}
