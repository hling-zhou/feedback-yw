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
 * 省代表回访"已纳入"标记（2026-11-04 需求8）。
 * 语义：导出待省代表回访表 / 发送待省代表回访邮件成功后，按 itemKey 标记"已交接出系统"。
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

  /**
   * 2026-11-10 需求③（用户拍板）：删除省代表回访记录 → 联动清理"已纳入"标记
   * （清单恢复勾选模式）。匹配：payload 身份三元组 + itemKey 前缀段双保险。
   * @param {{ month: string, productName: string, customerCode?: string, customerName?: string }} identity
   * @returns {number} 删除的标记条数
   */
  deleteByIdentity(identity) {
    const month = String(identity?.month || '').trim()
    const productName = String(identity?.productName || '').trim()
    const customerCode = String(identity?.customerCode || '').trim()
    const customerName = String(identity?.customerName || '').trim()
    const customer = customerCode || customerName
    if (!month || !productName || !customer) return 0
    // 全表扫描 + 内存精确匹配（dispatch 表量级小）：不依赖 payload JSON 键序
    // （LIKE '..."importMonth":"2026-09"...' 依赖 stringify 键序，序列化实现变化即静默失配）。
    // 匹配：payload 身份三元组（月+产品+客户名）或 itemKey 前缀段（q:客户:产品:）双保险。
    const rows = getDb()
      .prepare(
        `SELECT item_key, payload, source_type, dispatched_via, dispatched_at FROM post_use_visit_dispatch`,
      )
      .all()
    let deleted = 0
    const tx = getDb().transaction(() => {
      for (const row of rows) {
        let payload = {}
        try {
          payload = parseJson(row.payload)
        } catch {
          payload = {}
        }
        const payloadMatch =
          String(payload.importMonth || '') === month &&
          String(payload.productName || '') === productName &&
          String(payload.customerName || '') === customerName
        // itemKey 前缀段匹配（q:客户:产品:含该月）作双保险——payload 反序列化失败时仍可清
        const keyMatch =
          String(row.item_key || '').startsWith(`q:${customer}:${productName}:`) &&
          String(row.item_key || '').includes(month)
        if (!payloadMatch && !keyMatch) continue
        const result = getDb()
          .prepare(`DELETE FROM post_use_visit_dispatch WHERE item_key = ?`)
          .run(row.item_key)
        if (result.changes) deleted += result.changes
      }
    })
    tx()
    if (deleted) bumpDataRevision()
    return deleted
  },
}
