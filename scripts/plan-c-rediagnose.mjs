#!/usr/bin/env node
/**
 * Plan C 存量已诊断组重跑（一次性脚本，11-17）。
 * 背景：102 组存量已诊断组是「单页时代」产物（log_search 只拿第 1 页，关键证据截断，
 * 31 组被判「诊断能力缺口」存疑）。本脚本把存量组重置 pending 后用新链路重诊断：
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

/** 与 plan-c-daily diagnoseGroup 同构：新链路单组诊断（分页全量→规则→LLM→五段落库）。 */
async function diagnoseGroupNew(db, g, deps) {
  const { fetchPatrolDiagnosticLogs } = await import('../server/patrolDiagnose.js')
  const { classifyPatrolRootCause, extractDiagnosticText } = await import('../server/patrolRootCauseClassifier.js')
  const { readPatrolRootCauseRules } = await import('../server/patrolRepository.js')
  const { analyzeFailureByLlm } = await import('../server/patrolDiagnosisLlmAnalyzer.js')
  const { MCP_PRODUCT_NAMES, rules } = deps
  const fmt = (d, off) => {
    const t = new Date(d.getTime() + off * 60_000)
    const p = (n) => String(n).padStart(2, '0')
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
  }
  const firstTime = new Date(String(g.first_request_time).replace(' ', 'T'))
  const base = Number.isFinite(firstTime.getTime()) ? firstTime : new Date()
  const productName = MCP_PRODUCT_NAMES[String(g.product_key || '')] || 'fip/vpc'
  const filterKeyword = String(g.first_request_id || '').replace(/^reqId-/, '')
  const res = await fetchPatrolDiagnosticLogs(
    { mcpEndpoint: MCP_ENDPOINT, mcpToken: MCP_TOKEN },
    { startTime: fmt(base, -30), endTime: fmt(base, 30), productName, poolName: g.pool_name, filter: filterKeyword },
  )
  if (!res.ok) return { ok: false, reason: `MCP: ${res.error}` }
  const isElb = g.product_key === 'slb'
  const text = extractDiagnosticText(res.text, '', isElb)
  let classified = classifyPatrolRootCause(text, rules)
  let llmReport = { byLlm: false, llmFailed: false, attempts: 0, conclusion: null, directCause: [], evidence: [], suggestion: null, rootCauseL1: null }
  let rootCauseSource = 'rule'
  if (classified.l1 === '其他/未归类' || classified.l1 === '诊断能力缺口') {
    const analysis = await analyzeFailureByLlm(res.text, {
      apiPath: g.api_path, poolName: g.pool_name, userName: g.user_name, productKey: g.product_key,
    })
    if (analysis.llmFailed) return { ok: false, reason: `LLM ${analysis.attempts} 次全失败（未诊断——保持 pending 可重试）` }
    if (analysis.byLlm) {
      llmReport = analysis
      rootCauseSource = 'llm'
      if (analysis.rootCauseL1) classified = { ...classified, l1: analysis.rootCauseL1, l2: 'LLM结构化诊断' }
    }
  }
  let suggestion = llmReport.suggestion
  if (!suggestion) {
    const { generateDiagnosisSuggestion } = await import('../server/patrolDiagnosisSuggestion.js')
    suggestion = await generateDiagnosisSuggestion(text, text, classified.l1)
  }
  const directCauseJson = llmReport.directCause.length > 0 ? JSON.stringify(llmReport.directCause) : null
  const evidenceJson = llmReport.evidence.length > 0 ? JSON.stringify(llmReport.evidence) : null
  const conclusionFinal = llmReport.conclusion || text || null
  const now = new Date().toISOString()
  db.prepare('DELETE FROM api_patrol_diagnoses WHERE failure_group_id=?').run(g.id)
  db.prepare(`
    INSERT INTO api_patrol_diagnoses (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion, root_cause_l1, root_cause_l2, suggestion, direct_cause, evidence, root_cause_source, diagnosed_at)
    VALUES (?, ?, 'success', 'log_search', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(g.id, g.first_request_id, res.text, conclusionFinal, classified.l1, classified.l2, suggestion, directCauseJson, evidenceJson, rootCauseSource, now)
  db.prepare(`
    UPDATE api_patrol_failure_groups SET root_cause_l1=?, root_cause_l2=?, product_action_status=?, updated_at=? WHERE id=?
  `).run(classified.l1, classified.l2, classified.productAction, now, g.id)
  return { ok: true, l1: classified.l1, source: rootCauseSource, byLlm: llmReport.byLlm }
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
  const deps = { rules: readPatrolRootCauseRules(), MCP_PRODUCT_NAMES: { eip: 'fip/vpc', vpc: 'fip/vpc', slb: 'slb-console' } }

  // ① 收集重跑目标：已诊断但非新链路产物、无人工痕迹
  const placeholders = allDates.map(() => '?').join(',')
  const targets = db.prepare(`
    SELECT g.id, g.group_date, g.pool_name, g.product_key, g.api_path, g.user_name, g.first_request_id, g.first_request_time,
           g.product_action_status, g.root_cause_l1,
           (SELECT root_cause_source FROM api_patrol_diagnoses WHERE failure_group_id = g.id ORDER BY id DESC LIMIT 1) AS src
    FROM api_patrol_failure_groups g
    WHERE g.group_date IN (${placeholders})
  `).all(...allDates)
  const rerun = targets.filter((g) =>
    g.src == null                                    // 旧数据（root_cause_source 无值）
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