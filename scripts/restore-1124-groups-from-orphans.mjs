#!/usr/bin/env node
/**
 * 重放恢复（11-26 09:21 重复拉取事故修复）：
 * 今晨 Run #17 因护栏缺失重复灌 11-24 邮件 → compressPatrolDay DELETE+重建 18 组 →
 * 昨晚人工修正（双用户组归类）+ v5 迁移成果对 11-24 组全灭；诊断表老组行成孤儿（未删）。
 *
 * 恢复判据 = 孤儿诊断行（老组 id 384-401，含昨晚完整分类）按 first_request_id × user_name
 * 重挂新组（402-419），并把 L1/L2/status 回写组表。幂等：组已带分类时跳过。
 * 一次性脚本（事故恢复），但按惯例保留入库供审计追溯。
 */
import Database from 'better-sqlite3'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const DB_PATH = process.env.DB || path.join(REPO, 'server/data/plan-c-local.db')
const DATE = '2026-11-24'
const OLD_MIN = 384, OLD_MAX = 401
const COMMIT = process.argv.includes('--commit')

const db = new Database(DB_PATH)
db.pragma('journal_mode = WAL')

// ① 孤儿诊断行 → 按 (first_request_id, user_name) 找新组
const orphans = db.prepare(`SELECT failure_group_id oldId, request_id, root_cause_l1, root_cause_l2, status FROM api_patrol_diagnoses WHERE failure_group_id BETWEEN ? AND ?`).all(OLD_MIN, OLD_MAX)
const newGroups = db.prepare(`SELECT id, first_request_id, user_name, product_action_status FROM api_patrol_failure_groups WHERE group_date=?`).all(DATE)
const groupIndex = new Map()
for (const g of newGroups) {
  const key = `${g.first_request_id}\u0000${g.user_name}`
  groupIndex.set(key, g)
}
const oldUserByOldId = new Map() // 老组 id → user_name（从老组表已不存在——用孤儿行的组身份无法直接取，改为按 request_id 唯一匹配 + 双用户组按结论判别）
// 老组表行已被删——老组 user_name 从备份库取（.bak-11-25-pre-migrate-back 是迁移前形态，无 11-24 组；
// 正确源 = 昨晚迁移后、今晨重建前的组表……已不存在。改用审计/日志判据：双用户组两个孤儿行 request_id 相同，
// 一行 L1=可观测性不足（YHKJBJGF 的缺口判定）一行 L1=业务冲突（yidongyunyjy 的绑定判定）——按此消歧）。

console.log(`恢复面（${COMMIT ? 'COMMIT' : 'DRY-RUN'}）：孤儿行 ${orphans.length} 条 / 新组 ${newGroups.length} 组`)
let recoverable = 0, skipped = 0
const plan = []
for (const o of orphans) {
  const candidates = newGroups.filter((g) => g.first_request_id === o.request_id)
  if (candidates.length === 0) { console.log('  ⚠ 无新组可挂（跳过）:', o.oldId, o.request_id.slice(0, 24)); continue }
  let target
  if (candidates.length === 1) {
    target = candidates[0]
  } else {
    // 双用户组消歧：老组 #398=YHKJBJGF(缺口判定) / #399=yidongyunyjy(绑定判定)
    // 判据 = 孤儿行的 L1：可观测性不足/缺口 → YHKJBJGF；业务冲突/绑定 → yidongyunyjy（昨晚回填实录）
    const isYh = ['产品可观测性不足', '诊断能力缺口'].includes(o.root_cause_l1)
    target = candidates.find((g) => (isYh ? g.user_name === 'YHKJBJGF' : g.user_name === 'yidongyunyjy'))
    if (!target) { console.log('  ⚠ 双用户组消歧失败（跳过）:', o.oldId, o.root_cause_l1); continue }
  }
  if (target.product_action_status !== 'pending_diagnosis') {
    skipped++
    continue
  }
  plan.push({ orphan: o, target })
  recoverable++
}
console.log(`  可恢复 ${recoverable} 组 / 已恢复跳过 ${skipped} 组`)

if (!COMMIT) {
  for (const p of plan) {
    console.log(`  组#${p.target.id}(${p.target.user_name}) ← 孤儿#${p.orphan.oldId}: ${p.orphan.root_cause_l1 || '(空L1)'}/${p.orphan.root_cause_l2 || '(空L2)'}`)
  }
  console.log('dry-run 完成。--commit 执行真恢复。')
  db.close()
  process.exit(0)
}

// ---------- commit ----------
const bak = DB_PATH + '.bak-11-26-pre-recover'
import fs from 'node:fs'
if (!fs.existsSync(bak)) { fs.copyFileSync(DB_PATH, bak); console.log('库已备份 →', bak) }
else console.log('备份已存在（防覆盖），继续')

const now = new Date().toISOString()
const updGroup = db.prepare('UPDATE api_patrol_failure_groups SET root_cause_l1=?, root_cause_l2=?, product_action_status=?, updated_at=? WHERE id=?')
const reDiag = db.prepare('UPDATE api_patrol_diagnoses SET failure_group_id=? WHERE failure_group_id=?')
const recover = db.transaction(() => {
  for (const p of plan) {
    const o = p.orphan
    // status 推导：诊断 success → 昨晚组状态判据（缺口/可观测性 → 由 L1 语义定；L1 空（快速路径无诊断语义）→ pending 保持）
    // 具体判据（昨晚实录）：
    //   - L1=产品可观测性不足 → 待处理（#398 LLM 判定优先）
    //   - L1=业务冲突/绑定关系未解除 → 「—」（#399 LLM 判定）
    //   - 其余 LLM 主路径组 → 按诊断行 L1 语义：缺口类「—」、业务冲突/锁定/配额等有明确语义的按 LLM 判定恢复
    //   —— 通用规则：诊断行有 action_reason 语义时无法从孤儿行取（action_reason 在行里，可取）：
    let status = '待处理'
    const reasonRow = db.prepare('SELECT action_reason FROM api_patrol_diagnoses WHERE failure_group_id=?').get(o.oldId)
    const reason = String(reasonRow?.action_reason || '')
    if (o.root_cause_l1 === '产品可观测性不足' && reason.includes('需补提示')) status = '待处理'   // #398 语义（LLM 判定优先）
    else if (o.root_cause_l1 === '业务冲突' && o.root_cause_l2 === '绑定关系未解除') status = '—'  // #399 语义
    else if (o.root_cause_l1 === '诊断能力缺口') status = '—'
    else if (o.root_cause_l1 === '资源锁定&并发冲突' || o.root_cause_l1 === '配额不足' || o.root_cause_l1 === '参数无效&校验失败') status = '—'  // 客户侧/瞬时类
    else if (o.root_cause_l1 === '业务冲突') status = reason && !reason.includes('需产品') ? '—' : '待处理'
    else if (o.root_cause_l1 === '其他&未归类') status = '待处理'
    updGroup.run(o.root_cause_l1, o.root_cause_l2 || null, status, now, p.target.id)
    reDiag.run(p.target.id, o.oldId)
  }
})
recover()
console.log(`✅ 恢复完成：${plan.length} 组分类回写 + 诊断行重挂`)
for (const p of plan) {
  const g = db.prepare('SELECT id, user_name, root_cause_l1, root_cause_l2, product_action_status FROM api_patrol_failure_groups WHERE id=?').get(p.target.id)
  console.log(`  组#${g.id}(${g.user_name}): ${g.root_cause_l1 || '(空)'}/${g.root_cause_l2 || ''} / ${g.product_action_status}`)
}
db.close()
