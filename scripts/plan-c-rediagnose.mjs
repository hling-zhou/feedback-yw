#!/usr/bin/env node
/**
 * Plan C 存量已诊断组重跑（一次性脚本，11-17）。
 * 背景：102 组存量已诊断组是「单页时代」产物（log_search 只拿第 1 页，关键证据截断，
 * 31 组被判「诊断能力缺口」存疑）。本脚本把存量组重置 pending 后用新链路重诊断：
 * ——11-26 拆类注：「诊断能力缺口」语义已收窄为「MCP 查无数据」（诊断链路的锅）；
 * 「日志在但读不出」已迁新 L1「产品可观测性不足」（产品的锅，缺省待处理）。
 * 下行 149/161 行的缺口过滤只收窄后的缺口语义（查无数据组），新类组 status=待处理不命中。
 *   分页全量（fetchPatrolDiagnosticLogs）→ 规则初筛（加速）→ LLM 结构化（五段+根因枚举）
 *   → 逐日组包推送部署端（五段随 groups 附推）。
 *
 * 保护语义：
 * - 人工流程态（处理中/已处理）不重置不重跑（§10.3 同款保护）——本次检查无此类组，防御保留
 * - 新链路产物（root_cause_source='llm'/'rule'）不重跑（已是目标形态）
 * - root_cause_confirmed/measure_feedback 非空的组不重置（人工痕迹保护）
 *
 * 用法: node scripts/plan-c-rediagnose.mjs [--dry-run] [--dates 2026-11-09,2026-11-10]
 *   --dry-run: 只列出将重跑的组（不重置不诊断不推送）
 *   --dates:   逗号分隔日期列表（默认 2026-11-09 ~ 2026-11-16 全量）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const DRY_RUN = process.argv.includes('--dry-run')
// 11-19 补刷模式：只捞 pending_diagnosis 组（上轮 LLM 5 连败/中断遗留——
// 诊断逻辑没变时不该全量重刷制造边界类抖动，只补刷没刷上的组）
const PENDING_ONLY = process.argv.includes('--pending-only')
const datesIdx = process.argv.indexOf('--dates')
const DATES_ARG = datesIdx > -1 ? String(process.argv[datesIdx + 1] || '') : ''

function loadEnvFile() {
  const envPath = process.env.PLAN_C_ENV_FILE || path.join(REPO_ROOT, '.env-plan-c')
  if (!fs.existsSync(envPath)) { console.error('[rediag] .env-plan-c 缺失'); process.exit(2) }
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnvFile()

const LOCAL_DB = process.env.PLAN_C_LOCAL_DB || path.join(REPO_ROOT, 'server', 'data', 'plan-c-local.db')
const TARGET_URL = process.env.PLAN_C_TARGET_URL || ''
const PUSH_API_KEY = process.env.PLAN_C_PUSH_API_KEY || ''
const MCP_TOKEN = process.env.PLAN_C_MCP_TOKEN || ''
const MCP_ENDPOINT = process.env.PLAN_C_MCP_ENDPOINT || 'http://cni.mcp.server:31788/mcp-server/mcp'
const WINDOW_DAYS = 7
const MANUAL_FLOW_STATUSES = new Set(['处理中', '已处理'])

process.env.AUTH_DATABASE_PATH = LOCAL_DB
process.env.SERVER_DATA_DIR = path.dirname(LOCAL_DB)
fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true })

const log = (stage, msg) => console.log(`[rediag ${stage}] ${msg}`)

function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** 与 plan-c-daily diagnoseGroup 同构：新链路单组诊断——11-18 起统一走 patrolDiagnosisPipeline（归类流程倒转）。 */
async function diagnoseGroupNew(db, g, deps) {
  const { fetchPatrolDiagnosticLogs } = await import('../server/patrolDiagnose.js')
  const { rules } = deps
  const fmt = (d, off) => {
    const t = new Date(d.getTime() + off * 60_000)
    const p = (n) => String(n).padStart(2, '0')
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
  }
  const firstTime = new Date(String(g.first_request_time).replace(' ', 'T'))
  const base = Number.isFinite(firstTime.getTime()) ? firstTime : new Date()
  const MCP_PRODUCT_NAMES = { eip: 'fip/vpc', vpc: 'fip/vpc', slb: 'slb-console' }
  const productName = MCP_PRODUCT_NAMES[String(g.product_key || '')] || 'fip/vpc'
  const filterKeyword = String(g.first_request_id || '').replace(/^reqId-/, '')
  const res = await fetchPatrolDiagnosticLogs(
    { mcpEndpoint: MCP_ENDPOINT, mcpToken: MCP_TOKEN },
    { startTime: fmt(base, -30), endTime: fmt(base, 30), productName, poolName: g.pool_name, filter: filterKeyword },
  )
  if (!res.ok) return { ok: false, reason: `MCP: ${res.error}` }
  const isElb = g.product_key === 'slb'
  const { runPatrolDiagnosisPipeline } = await import('../server/patrolDiagnosisPipeline.js')
  const outcome = await runPatrolDiagnosisPipeline(res.text, {
    apiPath: g.api_path, poolName: g.pool_name, userName: g.user_name, productKey: g.product_key, isElb,
  }, { rules })
  if (outcome.status === 'no_diagnosis') return { ok: false, reason: `LLM ${outcome.llmAttempts} 次全失败（未诊断——保持 pending 可重试）` }
  let suggestion = outcome.suggestion
  if (!suggestion) {
    const { extractDiagnosticText } = await import('../server/patrolRootCauseClassifier.js')
    const { generateDiagnosisSuggestion } = await import('../server/patrolDiagnosisSuggestion.js')
    const text = extractDiagnosticText(res.text, '', isElb)
    suggestion = await generateDiagnosisSuggestion(outcome.conclusion || text, text, outcome.l1)
  }
  const directCauseJson = outcome.directCause.length > 0 ? JSON.stringify(outcome.directCause) : null
  const evidenceJson = outcome.evidence.length > 0 ? JSON.stringify(outcome.evidence) : null
  const now = new Date().toISOString()
  db.prepare('DELETE FROM api_patrol_diagnoses WHERE failure_group_id=?').run(g.id)
  db.prepare(`
    INSERT INTO api_patrol_diagnoses (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion, root_cause_l1, root_cause_l2, suggestion, direct_cause, evidence, root_cause_source, action_reason, diagnosed_at)
    VALUES (?, ?, 'success', 'log_search', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(g.id, g.first_request_id, res.text, outcome.conclusion, outcome.l1, outcome.l2, suggestion, directCauseJson, evidenceJson, outcome.rootCauseSource, outcome.actionReason ?? null, now)
  db.prepare(`
    UPDATE api_patrol_failure_groups SET root_cause_l1=?, root_cause_l2=?, product_action_status=?, updated_at=? WHERE id=?
  `).run(outcome.l1, outcome.l2, outcome.productAction, now, g.id)
  return { ok: true, l1: outcome.l1, source: outcome.rootCauseSource, byLlm: outcome.rootCauseSource === 'llm' }
}

/** 组包推送（与 plan-c-daily buildPackage 同构——从库内数据组装日包）。 */
async function buildPackageFor(db, dataDate) {
  const windowStart = localDateStr(new Date(Date.now() - WINDOW_DAYS * 24 * 3600 * 1000))
  const statsRows = db.prepare(`SELECT product_key, pool_name, metric_name, api_path, biz_type, success_rate, duration_normal_ratio, avg_duration FROM api_patrol_stats WHERE stat_date=?`).all(dataDate)
  const statsByProduct = new Map()
  for (const r of statsRows) {
    const key = String(r.product_key)
    if (!statsByProduct.has(key)) statsByProduct.set(key, [])
    statsByProduct.get(key).push({
      资源池: r.pool_name, 指标名称: r.metric_name, 接口名称: r.api_path, 业务类型: r.biz_type,
      成功率: `${r.success_rate}%`,
      正常比例: r.duration_normal_ratio == null ? '-' : `${r.duration_normal_ratio}%`,
      时长均值: r.avg_duration || '-',
    })
  }
  const requestPools = db.prepare(`SELECT DISTINCT pool_name AS p FROM api_patrol_requests WHERE request_date=?`).all(dataDate)
  const requests = []
  for (const pr of requestPools) {
    const pool = String(pr.p)
    const allRows = db.prepare(`SELECT * FROM api_patrol_requests WHERE request_date=? AND pool_name=?`).all(dataDate, pool)
    const elbRows = []; const eipVpcRows = []
    for (const r of allRows) (String(r.api_path || '').startsWith('/') ? eipVpcRows : elbRows).push(r)
    if (eipVpcRows.length > 0) requests.push({ package: 'eip_vpc', pool, rows: eipVpcRows.map((r) => ({
      id: r.external_row_id == null ? '' : String(r.external_row_id), appId: r.app_id || '', requestId: r.request_id, requestMapping: r.api_path,
      userId: r.user_id, userName: r.user_name, bizCategory: r.biz_category || '', bizTarget: r.biz_target || '', bizNo: r.biz_no || '',
      result: String(r.is_success), executionTimeMillis: r.duration_ms == null ? '' : String(r.duration_ms), createTime: r.request_time, diagnoseResult: '',
    })) })
    if (elbRows.length > 0) requests.push({ package: 'elb', pool, rows: elbRows.map((r) => {
      const [rt, ro] = String(r.api_path || '').split('/')
      return { id: r.external_row_id == null ? '' : String(r.external_row_id), requestId: r.request_id, userId: r.user_id,
        resourceType: rt || '', resourceOperation: ro || '', startTime: r.request_time, endTime: r.end_time || '',
        resultStatus: r.is_success === 1 ? 'SUCCESS' : 'FAILED', errorMessage: r.error_message || '',
        dailyReport: r.daily_report || '', realtimeReport: r.realtime_report || '', userName: r.user_name,
        executionTimeMillis: r.duration_ms == null ? '' : String(r.duration_ms), diagnoseResult: '' }
    }) })
  }
  const groups = db.prepare(`
    SELECT g.*, d.final_conclusion, d.suggestion, d.direct_cause, d.evidence, d.root_cause_source, d.status AS diag_status
    FROM api_patrol_failure_groups g
    LEFT JOIN api_patrol_diagnoses d ON d.failure_group_id = g.id
    WHERE g.group_date = ? OR (g.group_date >= ? AND g.updated_at >= datetime('now', '-2 days'))
       OR g.product_action_status = '—' AND g.root_cause_l1 = '诊断能力缺口'
  `).all(dataDate, windowStart).map((r) => ({
    groupDate: r.group_date, productKey: r.product_key, poolName: r.pool_name,
    apiPath: r.api_path, userName: r.user_name, metricName: r.metric_name,
    firstRequestId: r.first_request_id, firstRequestTime: r.first_request_time,
    preCompressCount: r.pre_compress_count, suppressedRequestIds: r.suppressed_request_ids,
    customerType: r.customer_type,
    rootCauseL1: r.root_cause_l1, rootCauseL2: r.root_cause_l2,
    finalConclusion: r.final_conclusion, suggestion: r.suggestion,
    directCause: r.direct_cause == null ? null : String(r.direct_cause),
    evidence: r.evidence == null ? null : String(r.evidence),
    rootCauseSource: r.root_cause_source == null ? null : String(r.root_cause_source),
    diagnosisStatus: r.product_action_status === '—' && r.root_cause_l1 === '诊断能力缺口'
      ? 'converged'
      : (r.diag_status === 'success' ? 'success' : 'failed'),
  }))
  return { date: dataDate, fetchedAt: new Date().toISOString(), stats: [...statsByProduct.entries()].map(([productKey, rows]) => ({ productKey, rows })), requests, groups }
}

async function pushPackage(pkg) {
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${TARGET_URL}/api/patrol/push/daily-package`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${PUSH_API_KEY}` },
        body: JSON.stringify(pkg),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: true, received: body.received }
      }
      lastError = `HTTP ${res.status}`
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch (err) { lastError = err.message }
    if (attempt < 3) await new Promise((r) => setTimeout(r, 5000 * attempt))
  }
  return { ok: false, error: lastError }
}

async function main() {
  const allDates = DATES_ARG ? DATES_ARG.split(',').map((s) => s.trim()).filter(Boolean)
    : ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']
  const { getDb, closeDb } = await import('../server/db.js')
  getDb()
  const { initBusinessSchema } = await import('../server/businessDb.js')
  initBusinessSchema()
  const db = getDb()
  const { readPatrolRootCauseRules } = await import('../server/patrolRepository.js')
  const deps = { rules: readPatrolRootCauseRules() }

  // ① 收集重跑目标：已诊断但非新链路产物、无人工痕迹
  const placeholders = allDates.map(() => '?').join(',')
  const targets = db.prepare(`
    SELECT g.id, g.group_date, g.pool_name, g.product_key, g.api_path, g.user_name, g.first_request_id, g.first_request_time,
           g.product_action_status, g.root_cause_l1,
           (SELECT root_cause_source FROM api_patrol_diagnoses WHERE failure_group_id = g.id ORDER BY id DESC LIMIT 1) AS src
    FROM api_patrol_failure_groups g
    WHERE g.group_date IN (${placeholders})
  `).all(...allDates)
  // 11-18 晚拍板（用户指令「存量 117 组全部重跑刷新」）：筛选放开 src——诊断逻辑更新
  // （错误码喂 LLM 现场判类、L2 场景化）后旧 LLM 产物同样需要重刷；人工痕迹三重保护不变。
  // src 沿留仅作日志参考，不再作为过滤条件。
  // --pending-only（11-19）：补刷模式——只捞 pending_diagnosis（上轮 LLM 5 连败/中断遗留组）。
  const rerun = targets.filter((g) =>
    (!PENDING_ONLY || g.product_action_status === 'pending_diagnosis')
    && !MANUAL_FLOW_STATUSES.has(g.product_action_status)
    && !(g.root_cause_confirmed_check)               // 防御位（下方 SQL 已过滤主条件）
  )
  // 人工痕迹过滤（root_cause_confirmed / measure_feedback 非空不重跑）
  const manualGuard = db.prepare(`
    SELECT COUNT(*) n FROM api_patrol_failure_groups
    WHERE id=? AND ((root_cause_confirmed IS NOT NULL AND root_cause_confirmed != '')
                 OR (measure_feedback IS NOT NULL AND measure_feedback != ''))
  `)
  const safe = rerun.filter((g) => Number(manualGuard.get(g.id).n) === 0)

  log('scan', `日期 ${allDates.join(', ')}：组 ${targets.length}，符合重跑条件（旧链路+无人工痕迹+非人工流程态）${safe.length} 组`)
  if (safe.length === 0) { log('scan', '无重跑目标——退出'); closeDb(); return }
  if (DRY_RUN) {
    for (const g of safe) log('dry', `#${g.id} ${g.group_date} ${g.pool_name} ${g.product_key} 当前「${g.root_cause_l1 || '未诊断'}」→ 重跑`)
    log('dry', `dry-run 完成：${safe.length} 组将重跑（未执行）`)
    closeDb()
    return
  }

  // ② 逐组重置 pending → 新链路诊断
  const resetStmt = db.prepare(`UPDATE api_patrol_failure_groups SET product_action_status='pending_diagnosis' WHERE id=?`)
  let okCount = 0; let failCount = 0; let llmCount = 0; let ruleCount = 0
  for (const g of safe) {
    resetStmt.run(g.id)
    const before = g.root_cause_l1 || '（无）'
    const r = await diagnoseGroupNew(db, g, deps)
    if (r.ok) {
      okCount += 1
      if (r.source === 'llm') llmCount += 1; else ruleCount += 1
      const changed = before !== r.l1 ? ' ⚡变更' : ''
      log('diag', `#${g.id} ${g.group_date}「${before}」→「${r.l1}」(${r.source})${changed}`)
    } else {
      failCount += 1
      log('diag', `#${g.id} 失败：${r.reason}（保持 pending，明日跑批自然重试）`)
    }
  }
  log('diag', `完成：${okCount} 成功（LLM ${llmCount} / 规则 ${ruleCount}）/ ${failCount} 失败保持 pending`)

  // ③ 逐日组包推送（五段随 groups 附推部署端）
  // 11-18 保护：全部组刷新失败（如 MCP 日志网关全挂 500）时不推「降级状态包」——
  // 否则会把部署端已诊断组状态打回 pending（本次刷新没产出任何新结果，推过去只有状态回退没有增益）。
  // 有成功组才推（部分成功时推：成功组的新产物需要上去，失败组保持 pending 的状态投影是真实语义）。
  if (okCount === 0 && failCount > 0) {
    log('push', `全部 ${failCount} 组刷新失败——跳过推送（避免把部署端已诊断状态打回 pending；明日日跑批刷新成功后随包自然同步）`)
    closeDb()
    log('done', '重跑完成（0 成功，未推送）。')
    return
  }
  for (const dataDate of allDates) {
    const has = db.prepare(`SELECT COUNT(*) n FROM api_patrol_failure_groups WHERE group_date=?`).get(dataDate)
    if (!Number(has.n)) continue
    const pkg = await buildPackageFor(db, dataDate)
    const groupsPushed = pkg.groups.length
    const pushResult = await pushPackage(pkg)
    if (pushResult.ok) log('push', `${dataDate}: received ${pushResult.received}（groups ${groupsPushed}）`)
    else log('push', `${dataDate}: 推送失败 ${pushResult.error}`)
  }
  closeDb()
  log('done', '重跑完成。')
}

main().catch((err) => {
  console.error('[rediag fatal]', err)
  process.exitCode = 2
})