#!/usr/bin/env node
/**
 * 迁移脚本（11-25 修复 B 的存量数据回迁）：
 * Run #16（2026-11-25 09:16）因 plan-c-daily.mjs 顶层静态 import 先于 env 赋值加载 db.js，
 * DB_PATH 固化为默认 auth.db，整批 11-24 巡检数据误写业务主库。
 * 本脚本把误写数据迁回 plan-c-local.db：
 *   - api_patrol_failure_groups（18 组，含六元组唯一键幂等 upsert）
 *   - api_patrol_diagnoses（18 条诊断行，随组 id 重定位，先删后插幂等）
 *   - api_patrol_requests / api_patrol_stats（同键 upsert，幂等）
 *
 * 迁移后从 auth.db 删除误写数据（业务主库不应持有巡检代理数据）。
 *
 * 幂等性：重复执行零变更（upsert 同键覆盖 + 删除条件限定巡检数据日期段）。
 * 安全性：先 dry-run（默认）打印迁移面；--commit 才真迁移；迁移前备份目标库（不覆盖已有备份）。
 *
 * 无 src 依赖（正则内嵌），可独立执行——先例 migrate-strip-linked-ticket-prefix.mjs。
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..')
const SRC = process.env.SRC_DB || path.join(REPO, 'server/data/auth.db')
const DST = process.env.DST_DB || path.join(REPO, 'server/data/plan-c-local.db')
const COMMIT = process.argv.includes('--commit')
// Run #16 误写数据日（数据日 11-24；11-09 批是更早的双写残留，内容与目标库一致，一并清理）
const DATES = ['2026-11-24']
const LEGACY_DATES = ['2026-11-09']

if (!fs.existsSync(SRC)) { console.error('源库不存在:', SRC); process.exit(1) }
if (!fs.existsSync(DST)) { console.error('目标库不存在:', DST); process.exit(1) }

const src = new Database(SRC)
const dst = new Database(DST)

const q = (sql, ...p) => src.prepare(sql).all(...p)
const tables = {
  groups: q(`SELECT * FROM api_patrol_failure_groups WHERE group_date IN (${DATES.map(() => '?').join(',')})`, ...DATES),
  requests: q(`SELECT * FROM api_patrol_requests WHERE request_date IN (${[...DATES, ...LEGACY_DATES].map(() => '?').join(',')})`, ...DATES, ...LEGACY_DATES),
  stats: q(`SELECT * FROM api_patrol_stats WHERE stat_date IN (${[...DATES, ...LEGACY_DATES].map(() => '?').join(',')})`, ...DATES, ...LEGACY_DATES),
}
// 诊断行按组 id 关联（迁移后用目标库新组 id 重新挂载）
const diagByGroup = new Map()
for (const g of tables.groups) {
  diagByGroup.set(g.id, src.prepare('SELECT * FROM api_patrol_diagnoses WHERE failure_group_id=?').all(g.id))
}

console.log(`迁移面（${COMMIT ? 'COMMIT' : 'DRY-RUN'}）：
  源  : ${SRC}
  目标: ${DST}
  - failure_groups : ${tables.groups.length} 组（${DATES.join(', ')}）
  - diagnoses      : ${[...diagByGroup.values()].reduce((a, v) => a + v.length, 0)} 条（随组重挂）
  - requests       : ${tables.requests.length} 行
  - stats          : ${tables.stats.length} 行`)
if (tables.groups.length === 0) { console.log('源库无待迁移数据——已迁移或无此日期段，幂等退出'); process.exit(0) }

if (!COMMIT) {
  // dry-run 校验：目标库是否已有同批数据（预演冲突）
  for (const g of tables.groups) {
    const exists = dst.prepare(`SELECT id FROM api_patrol_failure_groups
      WHERE group_date=? AND product_key=? AND pool_name=? AND api_path=? AND user_name=? AND first_request_id=?`)
      .get(g.group_date, g.product_key, g.pool_name, g.api_path, g.user_name, g.first_request_id)
    if (exists) console.log(`  ⚠ 目标库已有组（id=${exists.id}）：${g.group_date} ${g.pool_name} ${g.user_name} ${g.first_request_id} → upsert 覆盖`)
  }
  console.log('\ndry-run 完成。--commit 执行真迁移。')
  process.exit(0)
}

// ---------- commit ----------
// 备份目标库（不覆盖）
const bak = DST + '.bak-11-25-pre-migrate-back'
if (fs.existsSync(bak)) { console.error('备份已存在（防覆盖）:', bak); process.exit(1) }
fs.copyFileSync(DST, bak)
console.log('目标库已备份 →', bak)

const groupMap = new Map() // 源组 id → 目标组 id
const migrate = dst.transaction(() => {
  // ① groups（六元组唯一键 upsert——与部署端 upsertGroup 同键）
  const upGroup = dst.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2, product_action_status, assignee,
       root_cause_confirmed, measure_feedback, feedback_by, feedback_at,
       created_at, updated_at, action_id, established_action, action_schedule,
       root_cause_l1_manual, root_cause_l2_manual, real_root_cause)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_date, product_key, pool_name, api_path, user_name, first_request_id)
    DO UPDATE SET
      pre_compress_count=excluded.pre_compress_count,
      suppressed_request_ids=excluded.suppressed_request_ids,
      customer_type=excluded.customer_type,
      root_cause_l1=excluded.root_cause_l1,
      root_cause_l2=excluded.root_cause_l2,
      product_action_status=excluded.product_action_status,
      updated_at=excluded.updated_at
    RETURNING id
  `)
  for (const g of tables.groups) {
    const { id, ..._ } = g
    void id
    const newId = upGroup.get(
      g.group_date, g.product_key, g.pool_name, g.api_path, g.metric_name, g.user_name,
      g.first_request_id, g.first_request_time, g.pre_compress_count, g.suppressed_request_ids,
      g.customer_type, g.root_cause_l1, g.root_cause_l2, g.product_action_status, g.assignee,
      g.root_cause_confirmed, g.measure_feedback, g.feedback_by, g.feedback_at,
      g.created_at, g.updated_at, g.action_id, g.established_action, g.action_schedule,
      g.root_cause_l1_manual, g.root_cause_l2_manual, g.real_root_cause,
    ).id
    groupMap.set(g.id, newId)
  }
  // ② diagnoses（先删后插——与部署端 upsertDiagnoses 同语义）
  const delDiag = dst.prepare('DELETE FROM api_patrol_diagnoses WHERE failure_group_id=?')
  const insDiag = dst.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, suggestion, direct_cause, evidence, root_cause_source, action_reason, diagnosed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  for (const [srcGid, diags] of diagByGroup) {
    const newGid = groupMap.get(srcGid)
    delDiag.run(newGid)
    for (const d of diags) {
      insDiag.run(newGid, d.request_id, d.status, d.tool_name, d.mcp_raw_response, d.final_conclusion,
        d.root_cause_l1, d.root_cause_l2, d.suggestion, d.direct_cause, d.evidence, d.root_cause_source, d.action_reason, d.diagnosed_at)
    }
  }
  // ③ requests（同唯一键 upsert——v2 四列键）
  const upReq = dst.prepare(`
    INSERT INTO api_patrol_requests
      (external_row_id, request_date, pool_name, product_key, request_id, api_path, user_id, user_name,
       is_success, duration_ms, request_time, end_time, biz_category, biz_target, biz_no, error_message,
       pushed_diagnose, app_id, daily_report, realtime_report, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(request_date, pool_name, request_id, external_row_id)
    DO UPDATE SET is_success=excluded.is_success, duration_ms=excluded.duration_ms,
      end_time=excluded.end_time, error_message=excluded.error_message
  `)
  for (const r of tables.requests) {
    upReq.run(r.external_row_id, r.request_date, r.pool_name, r.product_key, r.request_id, r.api_path, r.user_id, r.user_name,
      r.is_success, r.duration_ms, r.request_time, r.end_time, r.biz_category, r.biz_target, r.biz_no, r.error_message,
      r.pushed_diagnose, r.app_id, r.daily_report, r.realtime_report, r.created_at)
  }
  // ④ stats（同唯一键 upsert——列序照 schema：stat_date, product_key, pool_name, api_path, metric_name）
  const upStat = dst.prepare(`
    INSERT INTO api_patrol_stats
      (stat_date, product_key, pool_name, metric_name, api_path, biz_type, success_rate, duration_normal_ratio, avg_duration, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(stat_date, product_key, pool_name, api_path, metric_name)
    DO UPDATE SET success_rate=excluded.success_rate,
      duration_normal_ratio=excluded.duration_normal_ratio, avg_duration=excluded.avg_duration
  `)
  for (const s of tables.stats) {
    upStat.run(s.stat_date, s.product_key, s.pool_name, s.metric_name, s.api_path, s.biz_type,
      s.success_rate, s.duration_normal_ratio, s.avg_duration, s.created_at, s.updated_at)
  }
})
migrate()
console.log(`✅ 目标库写入完成：组 ${groupMap.size} / 诊断 ${[...diagByGroup.values()].reduce((a, v) => a + v.length, 0)} / requests ${tables.requests.length} / stats ${tables.stats.length}`)

// ⑤ 清理源库（auth.db）误写数据——限定日期段，单事务
const delFromSrc = src.transaction(() => {
  const delDiag = src.prepare(`DELETE FROM api_patrol_diagnoses WHERE failure_group_id IN (SELECT id FROM api_patrol_failure_groups WHERE group_date IN (${DATES.map(() => '?').join(',')}))`)
  delDiag.run(...DATES)
  const delG = src.prepare(`DELETE FROM api_patrol_failure_groups WHERE group_date IN (${DATES.map(() => '?').join(',')})`)
  delG.run(...DATES)
  const delR = src.prepare(`DELETE FROM api_patrol_requests WHERE request_date IN (${[...DATES, ...LEGACY_DATES].map(() => '?').join(',')})`)
  delR.run(...DATES, ...LEGACY_DATES)
  const delS = src.prepare(`DELETE FROM api_patrol_stats WHERE stat_date IN (${[...DATES, ...LEGACY_DATES].map(() => '?').join(',')})`)
  delS.run(...DATES, ...LEGACY_DATES)
})
delFromSrc()
console.log('✅ 源库（auth.db）误写数据已清理（组/诊断/requests/stats）')

// 校验
const chk = dst.prepare(`SELECT COUNT(*) n FROM api_patrol_failure_groups WHERE group_date IN (${DATES.map(() => '?').join(',')})`).get(...DATES)
console.log(`校验：目标库 ${DATES.join(',')} 组数 = ${chk.n}（期望 ${tables.groups.length}）`)
src.close(); dst.close()
