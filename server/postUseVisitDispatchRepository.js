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

/**
 * 客服部回访"已纳入"标记（2026-11-04 需求8）。
 * 语义：导出待客服部回访表 / 发送待客服部回访邮件成功后，按 itemKey 标记"已交接出系统"。
 * 不可逆（无删除/撤销语义）；重复标记幂等——INSERT OR IGNORE 保留首次时间与来源。
 */
export const postUseVisitDispatchRepository = {
  list() {
    const rows = getDb()
      .prepare(
        `SELECT item_key, source_type, dispatched_via, dispatched_at, payload
         FROM post_use_visit_dispatch`,
      )
      .all()
    return rows.map((row) => ({
      itemKey: String(row.item_key || '').trim(),
      sourceType: String(row.source_type || ''),
      dispatchedVia: String(row.dispatched_via || ''),
      dispatchedAt: String(row.dispatched_at || ''),
      ...(() => {
        try {
          return parseJson(row.payload)
        } catch {
          return {}
        }
      })(),
    }))
  },

  /**
   * 批量标记（不可逆 + 幂等：已存在的 itemKey 忽略，不覆盖首次标记时间）。
   * @param {Array<Record<string, unknown>>} items
   * @returns {Array<{ itemKey: string }>} 本次新标记成功的条目
   */
  markMany(items) {
    const stmt = getDb().prepare(
      `INSERT OR IGNORE INTO post_use_visit_dispatch
        (item_key, source_type, dispatched_via, dispatched_at, payload)
       VALUES (?, ?, ?, ?, ?)`,
    )
    const marked = []
    const tx = getDb().transaction((list) => {
      for (const raw of list) {
        const itemKey = String(raw?.itemKey || '').trim()
        if (!itemKey) continue
        const result = stmt.run(
          itemKey,
          String(raw?.sourceType || ''),
          String(raw?.dispatchedVia || ''),
          String(raw?.dispatchedAt || nowIso()),
          stringifyJson({
            customerName: String(raw?.customerName || ''),
            productName: String(raw?.productName || ''),
            importMonth: String(raw?.importMonth || ''),
          }),
        )
        if (result.changes) marked.push({ itemKey })
      }
    })
    tx(items || [])
    if (marked.length) bumpDataRevision()
    return marked
  },
}
