/**
 * 一次性迁移脚本：post_use 举措存量 painPointSnapshot 回填（11-27 需求补齐）
 *
 * 背景：确立举措时客户反馈写入问题快照（painPointSnapshot）是 11-27 新上线的语义
 * （582a81f）。此前创建的存量 post_use 举措问题列为空——本脚本从每条举措**已关联的
 * 溯源（post_use_jira_items.customerFeedback）/ 回访（post_use_visit_records_v1.
 * userFeedbackText）**取客户反馈回填，使「产品举措与进展 · 用后即评」的问题列恢复完整。
 *
 * 回填规则（与运行时 fill-if-empty 语义一致，防缺陷规则 §1 存量矛盾一次性清理）：
 *   action_items 中 source='post_use' 且 painPointSnapshot 为空的行：
 *   - 找该举措的关联溯源记录（payload.actionIds 含该 id），取 customerFeedback；
 *   - 无溯源关联则找关联回访记录，取 userFeedbackText；
 *   - 多条关联时取信息量最大的一条（与回访预导入同判据：文本更长 = 信息量更大）；
 *   - 所有关联都无反馈文本则跳过（如实保留空，不造占位文案）。
 *
 * 幂等：painPointSnapshot 已有值的行自动跳过；重复执行终态「拟回填 0 条」= 完成。
 *
 * 用法：
 *   node scripts/migrate-postuse-action-painsnapshot.mjs [--dry-run]
 *   FEEDBACK_DB=/path/to/auth.db node scripts/migrate-postuse-action-painsnapshot.mjs
 *
 * 正式执行只在存在实际变更时备份 DB，且不覆盖已有备份；变更在单事务内执行，
 * 任一失败整体回滚。抄先例：migrate-postuse-action-productkey.mjs（11-18）。
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { copyFileSync, existsSync } from 'node:fs'
import Database from 'better-sqlite3'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DB_PATH = process.env.FEEDBACK_DB || path.resolve(__dirname, '../server/data/auth.db')

const dryRun = process.argv.includes('--dry-run')

function main() {
  const db = new Database(DB_PATH)
  try {
    console.log(`数据库: ${DB_PATH}`)
    if (dryRun) console.log('[DRY RUN] 只扫描不写入\n')

    // 关联溯源：action_id 不落列，全量扫 payload 的 actionIds（post_use_jira_items 量级小）
    const traceRows = db
      .prepare(`SELECT json_extract(payload, '$.actionIds') AS actionIds,
                       json_extract(payload, '$.customerFeedback') AS feedback
                FROM post_use_jira_items`)
      .all()
    /** @type {Map<string, string>} actionId → 最长 customerFeedback */
    const traceFeedbackByActionId = new Map()
    for (const row of traceRows) {
      const feedback = String(row.feedback || '').trim()
      if (!feedback) continue
      let ids
      try {
        ids = JSON.parse(row.actionIds || '[]')
      } catch {
        continue
      }
      if (!Array.isArray(ids)) continue
      for (const rawId of ids) {
        const id = String(rawId || '').trim()
        if (!id) continue
        const prev = traceFeedbackByActionId.get(id) || ''
        if (feedback.length > prev.length) traceFeedbackByActionId.set(id, feedback)
      }
    }

    // 关联回访：meta 存储的 post_use_visit_records_v1（与 postUseActionService 同读取路径）
    const visitMetaRow = db
      .prepare(`SELECT value FROM meta WHERE key = 'post_use_visit_records_v1'`)
      .get()
    /** @type {Map<string, string>} actionId → 最长 userFeedbackText */
    const visitFeedbackByActionId = new Map()
    if (visitMetaRow?.value) {
      try {
        const visits = JSON.parse(visitMetaRow.value)?.records
        if (Array.isArray(visits)) {
          for (const visit of visits) {
            const feedback = String(visit?.userFeedbackText || '').trim()
            if (!feedback) continue
            const ids = Array.isArray(visit?.actionIds) ? visit.actionIds : [visit?.actionId]
            for (const rawId of ids) {
              const id = String(rawId || '').trim()
              if (!id) continue
              const prev = visitFeedbackByActionId.get(id) || ''
              if (feedback.length > prev.length) visitFeedbackByActionId.set(id, feedback)
            }
          }
        }
      } catch {
        console.log('⚠ post_use_visit_records_v1 解析失败，跳过回访侧回填')
      }
    }

    // 候选：post_use 且问题为空
    const candidates = db
      .prepare(`SELECT id, payload FROM action_items
                WHERE source = 'post_use'
                  AND (json_extract(payload, '$.painPointSnapshot') IS NULL
                       OR json_extract(payload, '$.painPointSnapshot') = '')`)
      .all()
    console.log(`post_use 且问题为空的举措共 ${candidates.length} 行`)

    /** @type {Array<{ id: string, from: string, feedback: string }>} */
    const planned = []
    /** @type {Array<{ id: string, reason: string }>} */
    const skipped = []
    for (const row of candidates) {
      const traceFeedback = traceFeedbackByActionId.get(row.id) || ''
      const visitFeedback = visitFeedbackByActionId.get(row.id) || ''
      // 溯源优先（与确立举措的 owner 语义一致：问题源自产品部溯源的原始反馈）
      const feedback = traceFeedback || visitFeedback
      if (!feedback) {
        skipped.push({ id: row.id, reason: '关联溯源/回访均无客户反馈文本' })
        continue
      }
      planned.push({
        id: row.id,
        from: traceFeedback ? 'trace.customerFeedback' : 'visit.userFeedbackText',
        feedback,
      })
    }

    console.log(`拟回填 ${planned.length} 条`)
    for (const p of planned) {
      console.log(`  ${p.id} ← ${p.from}: ${p.feedback.slice(0, 50)}${p.feedback.length > 50 ? '…' : ''}`)
    }
    if (skipped.length) {
      console.log(`\n跳过 ${skipped.length} 条:`)
      for (const s of skipped.slice(0, 10)) console.log(`  ${s.id}（${s.reason}）`)
      if (skipped.length > 10) console.log(`  … 共 ${skipped.length} 条`)
    }

    if (dryRun) {
      console.log('\n[DRY RUN] 以上为将要执行的回填，未写入。确认无误后去掉 --dry-run 执行。')
      return
    }
    if (!planned.length) {
      console.log('\n无可回填条目（已回填完成或关联均无反馈），数据库未改动。')
      return
    }

    // ---- 备份（存在实际变更才备份；不覆盖已有备份）----
    const backupPath = `${DB_PATH}.pre-postuse-painsnapshot-migration.bak`
    if (existsSync(backupPath)) {
      console.log(`\n备份已存在、不覆盖: ${backupPath}`)
    } else {
      copyFileSync(DB_PATH, backupPath)
      console.log(`\n已备份: ${backupPath}`)
    }

    // ---- 执行（单事务；payload.painPointSnapshot 真源 + 幂等复核）----
    const readStmt = db.prepare(`SELECT payload FROM action_items WHERE id = ?`)
    const writeStmt = db.prepare(
      `UPDATE action_items SET payload = ? WHERE id = ?`,
    )
    const tx = db.transaction(() => {
      for (const p of planned) {
        const row = readStmt.get(p.id)
        if (!row) throw new Error(`行不存在: ${p.id}`)
        /** @type {Record<string, unknown>} */
        const payload = JSON.parse(row.payload)
        // 幂等复核：事务内他行不受影响，但防御性再查一次
        if (String(payload.painPointSnapshot || '').trim()) continue
        const next = { ...payload, painPointSnapshot: p.feedback }
        const result = writeStmt.run(JSON.stringify(next), p.id)
        if (!result.changes) throw new Error(`更新失败（changes=0）: ${p.id}`)
      }
    })
    tx()

    console.log(`\n回填完成：${planned.length} 条 painPointSnapshot 已从客户反馈写入。`)
  } finally {
    db.close()
  }
}

main()
