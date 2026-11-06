/**
 * 一次性迁移脚本：清单条目键补月份段（方案 B，2026-11-06）
 *
 * 背景：问卷类清单条目键原为 q:客户:产品（无月份），勾选/归档/已纳入跨月全局继承。
 * 新代码按 q:客户:产品:月1|月2…（达标月并集）生成键，本脚本把存量旧键补上月份段，
 * 使其与新键对齐。投诉回访 c:工单号 天然唯一，不动。
 *
 * 迁移规则（与本地已执行的一次完全一致）：
 *   1. post_use_jira_items 的 q: 键（不含 YYYY-MM 段）：按该行 import_month 列补 :月份
 *   2. post_use_callback_decisions 的 q: 键（不含月份段）：
 *      按「该客户×产品在 records 中的低分(<7)月并集」补 :月1|月2…
 *      （无低分月则回退按客户全部月并集；仍无则保留原键——旧误判孤儿键，无害）
 *   3. post_use_visit_dispatch 的 q: 键（不含月份段）：按 payload.importMonth 补 :月份
 *   4. 无月份段的旧键在新代码下「视为任意周期可见」（itemKeyPeriod 兜底语义），
 *      因此漏迁不会造成状态丢失，只会延续旧的全局继承显示——迁移是收敛不是抢救。
 *
 * 幂等：已含月份段的键自动跳过，重复执行安全。
 *
 * 用法：
 *   node scripts/migrate-itemkey-add-month.mjs [--dry-run]
 *   FEEDBACK_DB=/path/to/auth.db node scripts/migrate-itemkey-add-month.mjs
 *
 * 建议流程：先 --dry-run 看影响面 → 备份数据库文件 → 正式执行 → 验证。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync } from 'node:fs'
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

    // ---- 迁移 1：post_use_jira_items（归档条目，按 import_month 列补段）----
    const jiraRows = db
      .prepare(`SELECT item_key, import_month FROM post_use_jira_items WHERE item_key LIKE 'q:%'`)
      .all()
      .filter((r) => !hasMonthSeg(r.item_key))
    console.log(`post_use_jira_items 待迁移: ${jiraRows.length} 条`)
    for (const row of jiraRows) {
      const month = String(row.import_month || '').slice(0, 7)
      if (!month) {
        console.log(`  跳过（无月份）: ${row.item_key}`)
        continue
      }
      const newKey = `${row.item_key}:${month}`
      console.log(`  ${row.item_key} → ${newKey}`)
      if (!dryRun) {
        db.prepare('UPDATE post_use_jira_items SET item_key = ? WHERE item_key = ?').run(newKey, row.item_key)
      }
    }

    // ---- 迁移 2：post_use_callback_decisions（勾选，按客户×产品低分月并集补段）----
    const decRows = db
      .prepare(`SELECT item_key FROM post_use_callback_decisions WHERE item_key LIKE 'q:%'`)
      .all()
      .filter((r) => !hasMonthSeg(r.item_key))
    console.log(`\npost_use_callback_decisions 待迁移: ${decRows.length} 条`)
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
        console.log(`  跳过（格式不符）: ${row.item_key}`)
        continue
      }
      const code = m[1]
      const product = m[2]
      let months = pStmt.all(code, product).map((r) => String(r.import_month).slice(0, 7)).filter(Boolean)
      if (!months.length) {
        months = cStmt.all(code).map((r) => String(r.import_month).slice(0, 7)).filter(Boolean)
      }
      if (!months.length) {
        console.log(`  跳过（无低分月，保留原键）: ${row.item_key}`)
        continue
      }
      const newKey = `${row.item_key}:${months.join('|')}`
      console.log(`  ${row.item_key} → ${newKey}`)
      if (!dryRun) {
        db.prepare('UPDATE post_use_callback_decisions SET item_key = ? WHERE item_key = ?').run(newKey, row.item_key)
      }
    }

    // ---- 迁移 3：post_use_visit_dispatch（已纳入标记，按 payload.importMonth 补段）----
    let dispRows = []
    try {
      dispRows = db
        .prepare(`SELECT item_key, payload FROM post_use_visit_dispatch WHERE item_key LIKE 'q:%'`)
        .all()
        .filter((r) => !hasMonthSeg(r.item_key))
    } catch {
      console.log('\npost_use_visit_dispatch 表不存在（库为旧版本，无已纳入标记存量）——跳过')
    }
    if (dispRows.length) {
      console.log(`\npost_use_visit_dispatch 待迁移: ${dispRows.length} 条`)
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
          console.log(`  跳过（payload 无 importMonth）: ${row.item_key}`)
          continue
        }
        const newKey = `${row.item_key}:${month}`
        console.log(`  ${row.item_key} → ${newKey}`)
        if (!dryRun) {
          db.prepare('UPDATE post_use_visit_dispatch SET item_key = ? WHERE item_key = ?').run(newKey, row.item_key)
        }
      }
    }

    // ---- 收尾：验证 + 备份提示 ----
    if (!dryRun) {
      const remainJira = db
        .prepare(`SELECT COUNT(*) n FROM post_use_jira_items WHERE item_key LIKE 'q:%'`)
        .get()
      const remainDec = db
        .prepare(`SELECT COUNT(*) n FROM post_use_callback_decisions WHERE item_key LIKE 'q:%'`)
        .get()
      console.log(`\n迁移完成。库内 q: 键现状: jira ${remainJira.n} 条 / decisions ${remainDec.n} 条（均应已含月份段）`)
    } else {
      console.log('\n[DRY RUN] 以上为将要执行的变更，未写入。确认无误后去掉 --dry-run 执行。')
    }
  } finally {
    db.close()
  }
}

// 正式执行前自动备份 DB 文件（dry-run 不备）
if (!dryRun) {
  const backupPath = `${DB_PATH}.pre-itemkey-migration.bak`
  copyFileSync(DB_PATH, backupPath)
  console.log(`已自动备份: ${backupPath}\n`)
}

main()
