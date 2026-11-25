/**
 * 一次性迁移脚本：action_items.linkedTicketIds 剥导出月份前缀（P2-A，2026-11-25）
 *
 * 背景：导出格式为 `${month}: ${ids}`（actionItemLinkedFeedback.
 * formatLinkedTicketIdsGroupedForExport），再导入时 parseLinkedTicketIdsCell
 * 按分隔符切分后前缀残留（如「未知月份: 202608…X918103377」「2026-05: T-1」），
 * 与 records 裸工单号 join 不上 → 举措在问题压降视图/抽屉补拉/周期过滤等
 * 19 处消费方整体失联（真库实测 133 条断裂）。导入端解析已修（strip 函数），
 * 本脚本把存量 linkedTicketIds / linkedRequirementTicketIds 归位为裸工单号。
 *
 * 迁移规则：
 *   数组每段剥 `^\d{4}-\d{1,2}: ` / `^未知月份: `（全/半角冒号）前缀；
 *   剥后为空的段丢弃；剥后去重（跨段同号只留一个）。
 *   整个字段无任何变化（已是裸号）的举措自动跳过——幂等。
 *
 * 不静默丢弃：剥后与 records（ticket_id 列 OR payload.ticketId）都 join 不上的号，
 *   照样写入（保留关联痕迹），但在报告中单列统计——由用户判断这些工单是否
 *   已被清理/别库，再决定是否手工解除关联。
 *
 * 用法：
 *   node scripts/migrate-strip-linked-ticket-prefix.mjs [--dry-run]
 *   FEEDBACK_DB=/path/to/auth.db node scripts/migrate-strip-linked-ticket-prefix.mjs
 *
 * 正式执行只在存在实际变更时备份 DB，且不覆盖已有备份；变更单事务，任一失败整体回滚。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.FEEDBACK_DB || path.resolve(__dirname, '../server/data/auth.db')

const dryRun = process.argv.includes('--dry-run')

/** 与 src/lib/actionItemImport.js stripLinkedTicketIdMonthPrefix 同一规则（单源口径注释互指） */
const PREFIX_RE = /^\s*(?:\d{4}-\d{1,2}|未知月份)\s*[:：]\s*/

/**
 * @param {unknown} raw
 * @returns {{ changed: boolean; next: string[]; stripped: string[] }}
 */
function stripField(raw) {
  if (!Array.isArray(raw)) return { changed: false, next: [], stripped: [] }
  /** @type {string[]} */
  const next = []
  /** @type {string[]} */
  const stripped = []
  const seen = new Set()
  for (const item of raw) {
    const s = String(item ?? '')
    const bare = s.replace(PREFIX_RE, '').trim()
    if (bare !== s) stripped.push(`${s} → ${bare || '(空，丢弃)'}`)
    if (!bare) continue
    if (seen.has(bare)) {
      stripped.push(`${s} → ${bare}（去重）`)
      continue
    }
    seen.add(bare)
    next.push(bare)
  }
  const changed =
    next.length !== raw.length || next.some((v, i) => v !== String(raw[i] ?? '').trim())
  return { changed, next, stripped }
}

function main() {
  const db = new Database(DB_PATH)
  try {
    console.log(`数据库: ${DB_PATH}`)
    if (dryRun) console.log('[DRY RUN] 只扫描不写入\n')

    // records 工单号索引：ticket_id 列 + payload.ticketId 双口径
    const recordTicketIds = new Set()
    for (const row of db.prepare(`SELECT ticket_id, payload FROM records`).all()) {
      if (row.ticket_id) recordTicketIds.add(String(row.ticket_id).trim())
      try {
        const p = JSON.parse(row.payload)
        if (p?.ticketId) recordTicketIds.add(String(p.ticketId).trim())
      } catch { /* payload 非法已有既有口径兜底 */ }
    }

    const rows = db.prepare(`SELECT id, payload FROM action_items`).all()
    /** @type {Array<{ id: string; payload: string; nextLinked: string[]; nextRequirement: string[]; changedFields: string[] }>} */
    const planned = []
    /** @type {Array<{ id: string; field: string; detail: string }>} */
    const changes = []
    /** @type {Array<{ id: string; field: string; ticketId: string }>} */
    const unjoinable = []

    for (const row of rows) {
      /** @type {Record<string, unknown>} */
      let payload
      try {
        payload = JSON.parse(row.payload)
      } catch {
        console.warn(`  ! 跳过 ${row.id}：payload 非法 JSON`)
        continue
      }
      const linked = stripField(payload.linkedTicketIds)
      const requirement = stripField(payload.linkedRequirementTicketIds)
      const changedFields = []
      if (linked.changed) changedFields.push('linkedTicketIds')
      if (requirement.changed) changedFields.push('linkedRequirementTicketIds')
      if (!changedFields.length) continue

      for (const bare of linked.next) {
        if (!recordTicketIds.has(bare)) unjoinable.push({ id: row.id, field: 'linkedTicketIds', ticketId: bare })
      }

      planned.push({
        id: row.id,
        payload: row.payload,
        nextLinked: linked.changed ? linked.next : String(payload.linkedTicketIds ?? 'undefined'),
        nextRequirement: requirement.changed ? requirement.next : payload.linkedRequirementTicketIds,
        changedFields,
      })
      for (const detail of linked.stripped) changes.push({ id: row.id, field: 'linkedTicketIds', detail })
      for (const detail of requirement.stripped) changes.push({ id: row.id, field: 'linkedRequirementTicketIds', detail })
    }

    console.log(`action_items 共 ${rows.length} 行，拟变更 ${planned.length} 条举措`)
    for (const c of changes) console.log(`  ${c.id} [${c.field}] ${c.detail}`)

    if (unjoinable.length) {
      console.log(`\n剥后仍 join 不上 records 的工单号 ${unjoinable.length} 个（照样写入保留痕迹，请人工判断是否清理）：`)
      for (const u of unjoinable) console.log(`  ${u.id} [${u.field}] ${u.ticketId}`)
    }

    if (dryRun) {
      console.log('\n[DRY RUN] 以上为将要执行的变更，未写入。确认无误后去掉 --dry-run 执行。')
      return
    }
    if (!planned.length) {
      console.log('\n无可变更条目（已迁移完成），数据库未改动。')
      return
    }

    // ---- 备份（存在实际变更才备份；不覆盖已有备份，保留最早迁移前状态供回滚）----
    const backupPath = `${DB_PATH}.pre-strip-linked-prefix-migration.bak`
    if (existsSync(backupPath)) {
      console.log(`\n备份已存在、不覆盖: ${backupPath}`)
    } else {
      copyFileSync(DB_PATH, backupPath)
      console.log(`\n已备份: ${backupPath}`)
    }

    // ---- 执行（单事务，任一失败整体回滚）----
    const writeStmt = db.prepare(`UPDATE action_items SET payload = ? WHERE id = ?`)
    const tx = db.transaction(() => {
      for (const p of planned) {
        /** @type {Record<string, unknown>} */
        const payload = JSON.parse(p.payload)
        if (p.changedFields.includes('linkedTicketIds')) payload.linkedTicketIds = p.nextLinked
        if (p.changedFields.includes('linkedRequirementTicketIds')) payload.linkedRequirementTicketIds = p.nextRequirement
        const result = writeStmt.run(JSON.stringify(payload), p.id)
        if (!result.changes) throw new Error(`更新失败（changes=0）: ${p.id}`)
      }
    })
    tx()

    console.log(`\n迁移完成：${planned.length} 条举措的关联工单号已归位裸号。`)
    if (unjoinable.length) {
      console.log(`其中 ${unjoinable.length} 个工单号在 records 中不存在（已保留写入，见上方清单）。`)
    }
  } finally {
    db.close()
  }
}

main()
