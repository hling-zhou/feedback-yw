/**
 * 一次性迁移脚本：清单条目键补月份段（方案 B，2026-11-06）
 *
 * 背景：问卷类清单条目键原为 q:客户:产品（无月份），勾选/归档/已纳入跨月全局继承。
 * 新代码按 q:客户:产品:月1|月2…（达标月并集）生成键，本脚本把存量旧键补上月份段，
 * 使其与新键对齐。投诉回访 c:工单号 天然唯一，不动。
 *
 * 迁移规则：
 *   1. post_use_jira_items 的 q: 键（不含 YYYY-MM 段）：按该行 import_month 列补 :月份
 *   2. post_use_callback_decisions 的 q: 键（不含月份段）：
 *      按「该客户×产品在 records 中的低分(<7)月并集」补 :月1|月2…
 *      （无低分月则回退按客户全部低分月并集；仍无则保留原键——负面反馈/重点客户
 *      路径入选的勾选无低分记录，旧键在新代码下任意周期可见，状态不丢）
 *   3. post_use_visit_dispatch 的 q: 键（不含月份段）：按 payload.importMonth 补 :月份
 *
 * 幂等与成功标志：已含月份段的键自动跳过；保留原键的条目重复执行永远显示「保留」。
 *      终态输出「拟变更 0 条 / 无可变更条目，数据库未改动」= 迁移完成。
 *
 * 用法：
 *   node scripts/migrate-itemkey-add-month.mjs [--dry-run]
 *   FEEDBACK_DB=/path/to/auth.db node scripts/migrate-itemkey-add-month.mjs
 *
 * 执行顺序要求：先部署新代码（be386ce+），再跑本脚本（顺序反了会有窗口期
 * 存量勾选显示失配）。正式执行只在存在实际变更时备份 DB，且不覆盖已有备份
 * （保留最早一次的迁移前状态供回滚）；变更在单事务内执行，任一失败整体回滚。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.FEEDBACK_DB || path.resolve(__dirname, '../server/data/auth.db')

const dryRun = process.argv.includes('--dry-run')
const MONTH_SEG_RE = /:(\d{4}-\d{2})(\|\d{4}-\d{2})*$/

/** 判断 itemKey 是否已含月份段 */
function hasMonthSeg(itemKey) {
  return MONTH_SEG_RE.test(String(itemKey || ''))
}

function main() {
  const db = new Database(DB_PATH)
  try {
    console.log(`数据库: ${DB_PATH}`)
    if (dryRun) console.log('[DRY RUN] 只扫描不写入\n')

    /** @type {Array<{table: 'jira'|'decisions'|'dispatch', oldKey: string, newKey: string}>} */
    const planned = []
    /** @type {Array<{key: string, reason: string}>} */
    const skipped = []

    // ---- 表 1：post_use_jira_items（归档条目，按 import_month 列补段）----
    const jiraRows = db
      .prepare(`SELECT item_key, import_month FROM post_use_jira_items WHERE item_key LIKE 'q:%'`)
      .all()
      .filter((r) => !hasMonthSeg(r.item_key))
    for (const row of jiraRows) {
      const month = String(row.import_month || '').slice(0, 7)
      if (!month) {
        skipped.push({ key: row.item_key, reason: '无 import_month' })
        continue
      }
      planned.push({ table: 'jira', oldKey: row.item_key, newKey: `${row.item_key}:${month}` })
    }

    // ---- 表 2：post_use_callback_decisions（勾选，按客户×产品低分月并集补段）----
    const decRows = db
      .prepare(`SELECT item_key FROM post_use_callback_decisions WHERE item_key LIKE 'q:%'`)
      .all()
      .filter((r) => !hasMonthSeg(r.item_key))
    const pStmt = db.prepare(
      `SELECT DISTINCT import_month FROM records
       WHERE json_extract(payload, '$.customerCode') = ?
         AND json_extract(payload, '$.productName') = ?
         AND json_extract(payload, '$.ratingScore') < 7
       ORDER BY import_month`,
    )
    const cStmt = db.prepare(
      `SELECT DISTINCT import_month FROM records
       WHERE json_extract(payload, '$.customerCode') = ?
         AND json_extract(payload, '$.ratingScore') < 7
       ORDER BY import_month`,
    )
    for (const row of decRows) {
      const m = String(row.item_key).match(/^q:([^:]+):(.+)$/)
      if (!m) {
        skipped.push({ key: row.item_key, reason: '格式不符' })
        continue
      }
      const code = m[1]
      const product = m[2]
      let months = pStmt.all(code, product).map((r) => String(r.import_month).slice(0, 7)).filter(Boolean)
      if (!months.length) {
        months = cStmt.all(code).map((r) => String(r.import_month).slice(0, 7)).filter(Boolean)
      }
      if (!months.length) {
        skipped.push({ key: row.item_key, reason: '无低分月（负面反馈/重点客户路径勾选）' })
        continue
      }
      planned.push({ table: 'decisions', oldKey: row.item_key, newKey: `${row.item_key}:${months.join('|')}` })
    }

    // ---- 表 3：post_use_visit_dispatch（已纳入标记，按 payload.importMonth 补段）----
    let dispatchExists = true
    let dispRows = []
    try {
      dispRows = db
        .prepare(`SELECT item_key, payload FROM post_use_visit_dispatch WHERE item_key LIKE 'q:%'`)
        .all()
        .filter((r) => !hasMonthSeg(r.item_key))
    } catch {
      dispatchExists = false
      console.log('post_use_visit_dispatch 表不存在（库为旧版本，无已纳入标记存量）——跳过\n')
    }
    if (dispatchExists) {
      for (const row of dispRows) {
        /** @type {{ importMonth?: string }} */
        let payload = {}
        try {
          payload = JSON.parse(row.payload)
        } catch {
          payload = {}
        }
        const month = String(payload?.importMonth || '').slice(0, 7)
        if (!month) {
          skipped.push({ key: row.item_key, reason: 'payload 无 importMonth' })
          continue
        }
        planned.push({ table: 'dispatch', oldKey: row.item_key, newKey: `${row.item_key}:${month}` })
      }
    }

    // ---- 汇报（拟变更与保留分开计数，终态一眼可辨）----
    for (const [label, table] of [
      ['post_use_jira_items', 'jira'],
      ['post_use_callback_decisions', 'decisions'],
      ['post_use_visit_dispatch', 'dispatch'],
    ]) {
      const changes = planned.filter((p) => p.table === table)
      console.log(`${label}: 拟变更 ${changes.length} 条`)
      for (const p of changes) console.log(`  ${p.oldKey} → ${p.newKey}`)
    }
    if (skipped.length) {
      console.log(`\n保留原键 ${skipped.length} 条（旧格式键在新代码下任意周期可见，状态不丢）:`)
      for (const s of skipped) console.log(`  ${s.key}（${s.reason}）`)
    }

    if (dryRun) {
      console.log('\n[DRY RUN] 以上为将要执行的变更，未写入。确认无误后去掉 --dry-run 执行。')
      return
    }

    if (!planned.length) {
      console.log('\n无可变更条目（已迁移完成或全部属保留原键兜底），数据库未改动。')
      return
    }

    // ---- 备份（存在实际变更才备份；不覆盖已有备份，保留最早迁移前状态供回滚）----
    const backupPath = `${DB_PATH}.pre-itemkey-migration.bak`
    if (existsSync(backupPath)) {
      console.log(`\n备份已存在、不覆盖: ${backupPath}`)
    } else {
      copyFileSync(DB_PATH, backupPath)
      console.log(`\n已备份: ${backupPath}`)
    }

    // ---- 执行（单事务，任一失败整体回滚）----
    const updateStmts = {
      jira: db.prepare('UPDATE post_use_jira_items SET item_key = ? WHERE item_key = ?'),
      decisions: db.prepare('UPDATE post_use_callback_decisions SET item_key = ? WHERE item_key = ?'),
      dispatch: db.prepare('UPDATE post_use_visit_dispatch SET item_key = ? WHERE item_key = ?'),
    }
    const tx = db.transaction(() => {
      for (const p of planned) {
        const stmt = updateStmts[p.table]
        if (!stmt) throw new Error(`未知表标识: ${p.table}`)
        const result = stmt.run(p.newKey, p.oldKey)
        if (!result.changes) throw new Error(`更新失败（行不存在）: ${p.oldKey}`)
      }
    })
    tx()

    console.log(`\n迁移完成：${planned.length} 条键已补月份段；${skipped.length} 条保留原键（兜底语义覆盖）。`)
  } finally {
    db.close()
  }
}

main()
