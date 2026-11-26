#!/usr/bin/env node
/**
 * Plan C 历史数据压缩+诊断+组包+推送批处理。
 * 对指定日期列表逐日执行 plan-c-daily.mjs 的 ②③④⑤ 阶段。
 *
 * 用法: node scripts/plan-c-historical-push.mjs [--dry-run] [--skip-diagnose]
 *   --dry-run: 只压缩+组包不推送
 *   --skip-diagnose: 跳过 MCP 诊断（已知 MCP 下游不可用时）
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')
const DRY_RUN = process.argv.includes('--dry-run')
const SKIP_DIAGNOSE = process.argv.includes('--skip-diagnose')

// ---------- env
function loadEnvFile() {
  const envPath = process.env.PLAN_C_ENV_FILE || path.join(REPO_ROOT, '.env-plan-c')
  if (!fs.existsSync(envPath)) {
    console.error('[push-hist] .env-plan-c 缺失')
    process.exit(2)
  }
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
const DIAGNOSIS_RETRY_WINDOW_DAYS = 7
// 11-20 20:04 拍板：定向补跑开关——只补「success 诊断但 mcp_raw_response 为空」的组（日包断供的
// 存量形态），重跑后只回填诊断事实字段，product_action_status 一律不动（绕开状态覆盖风险）。
// 用法：REDIAGNOSE_EMPTY_RAW=1 node scripts/plan-c-historical-push.mjs
const REDIAGNOSE_EMPTY_RAW = process.env.REDIAGNOSE_EMPTY_RAW === '1'

process.env.AUTH_DATABASE_PATH = LOCAL_DB
process.env.SERVER_DATA_DIR = path.dirname(LOCAL_DB)
fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true })

const log = (msg) => console.log(`[push-hist] ${msg}`)

function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

async function pushPackage(pkg) {
  const url = `${TARGET_URL}/api/patrol/push/daily-package`
  let lastError = ''
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${PUSH_API_KEY}`,
        },
        body: JSON.stringify(pkg),
        signal: AbortSignal.timeout(60_000),
      })
      if (res.ok) {
        const body = await res.json().catch(() => ({}))
        return { ok: true, summary: { received: body.received, reportAction: body.reportAction } }
      }
      lastError = `HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < 3) {
      log(`推送重试 ${attempt + 1}/3（${lastError}）`)
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
  return { ok: false, error: lastError }
}

async function runDiagnose(db, dataDate) {
  const { callMcpTool } = await import('../server/patrolDiagnose.js')
  const { classifyPatrolRootCause, extractDiagnosticText } = await import('../server/patrolRootCauseClassifier.js')
  const { readPatrolRootCauseRules } = await import('../server/patrolRepository.js')
  const rules = readPatrolRootCauseRules()
  const MCP_PRODUCT_NAMES = { eip: 'fip/vpc', vpc: 'fip/vpc', slb: 'slb-console' }

  const windowStart = localDateStr(new Date(Date.now() - DIAGNOSIS_RETRY_WINDOW_DAYS * 24 * 3600 * 1000))
  // 队列双模式（11-20 20:04 拍板）：
  // 默认=pending_diagnosis 组（当日+近7天窗口）；REDIAGNOSE_EMPTY_RAW=1=success 诊断但 raw 为空的组
  // （全窗口不限 7 天——日志保留期内都可补；断供期间落的组按 group_date 升序补）
  const queue = REDIAGNOSE_EMPTY_RAW
    ? db.prepare(`
        SELECT g.id, g.group_date, g.pool_name, g.product_key, g.first_request_id, g.first_request_time
        FROM api_patrol_failure_groups g
        JOIN api_patrol_diagnoses d ON d.failure_group_id = g.id AND d.status = 'success'
        WHERE d.mcp_raw_response IS NULL OR TRIM(d.mcp_raw_response) = ''
        ORDER BY g.group_date, g.first_request_time
      `).all()
    : db.prepare(`
        SELECT id, group_date, pool_name, product_key, first_request_id, first_request_time
        FROM api_patrol_failure_groups
        WHERE product_action_status='pending_diagnosis'
          AND (group_date = ? OR (group_date >= ? AND group_date < ?))
        ORDER BY group_date, first_request_time
      `).all(dataDate, windowStart, localDateStr(new Date()))

  if (queue.length === 0) return { total: 0, succeeded: 0, failed: 0 }
  log(REDIAGNOSE_EMPTY_RAW
    ? `定向补跑：${queue.length} 组（success 诊断但 raw 为空——只回填诊断事实，状态不动）`
    : `重试队列：${queue.length} 组`)

  const fmt = (d, offsetMin) => {
    const t = new Date(d.getTime() + offsetMin * 60_000)
    const p = (n) => String(n).padStart(2, '0')
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
  }

  let succeeded = 0
  let failed = 0

  for (const g of queue) {
    const firstTime = new Date(String(g.first_request_time).replace(' ', 'T'))
    const base = Number.isFinite(firstTime.getTime()) ? firstTime : new Date()
    const productName = MCP_PRODUCT_NAMES[String(g.product_key || '')] || 'fip/vpc'
    try {
      // 11-17：filter 剥 reqId- 前缀（连字符触发下游 412）；分页拉全量（单页截断曾致证据丢失）
      const filterKeyword = String(g.first_request_id || '').replace(/^reqId-/, '')
      const { fetchPatrolDiagnosticLogs } = await import('../server/patrolDiagnose.js')
      const res = await fetchPatrolDiagnosticLogs(
        { mcpEndpoint: MCP_ENDPOINT, mcpToken: MCP_TOKEN },
        { startTime: fmt(base, -30), endTime: fmt(base, 30), productName, poolName: g.pool_name, filter: filterKeyword },
      )
      if (!res.ok) {
        failed += 1
        continue
      }
      const isElb = g.product_key === 'slb'
      const text = extractDiagnosticText(res.text, '', isElb)
      const classified = classifyPatrolRootCause(text, rules)
      const now = new Date().toISOString()
      db.prepare('DELETE FROM api_patrol_diagnoses WHERE failure_group_id=?').run(g.id)
      db.prepare(`
        INSERT INTO api_patrol_diagnoses (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion, root_cause_l1, root_cause_l2, diagnosed_at)
        VALUES (?, ?, 'success', 'log_search', ?, ?, ?, ?, ?)
      `).run(g.id, g.first_request_id, res.text, text || null, classified.l1, classified.l2, now)
      if (REDIAGNOSE_EMPTY_RAW) {
        // 定向补跑模式（11-20 20:04 拍板）：只回填诊断事实——product_action_status 与
        // root_cause_l1/l2 的组级状态一律不动（绕开「已处理/处理中被打回待处理」的覆盖风险；
        // 组的根因/状态当时已正确落库，本次补的只是日志原文与诊断行事实）。
        // updated_at 必须 bump（真链路验证暴露的推送缺口）：buildPackageFor 按
        // 「updated_at 近 2 天」判定事实变化——不 bump 则补的 raw 永远进不了日包。
        // updated_at 不参与任何业务判定，仅作推送信号，语义安全。
        db.prepare('UPDATE api_patrol_failure_groups SET updated_at=? WHERE id=?').run(now, g.id)
        log('rediagnose', `组 #${g.id} 日志原文已回填（raw ${res.text.length} 字）——组状态未动`)
      } else {
        db.prepare(`
          UPDATE api_patrol_failure_groups SET root_cause_l1=?, root_cause_l2=?, product_action_status=?, updated_at=? WHERE id=?
        `).run(classified.l1, classified.l2, classified.productAction, now, g.id)
      }
      succeeded += 1
    } catch {
      failed += 1
    }
  }
  return { total: queue.length, succeeded, failed }
}

// buildPackage 逻辑（同 plan-c-daily.mjs ④，内联避免 import 触发其 main() 自动执行）
async function buildPackageFor(db, dataDate) {
  const localDateStr2 = (d) => {
    const p = (n) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
  }
  const windowStart = localDateStr2(new Date(Date.now() - DIAGNOSIS_RETRY_WINDOW_DAYS * 24 * 3600 * 1000))

  const statsRows = db.prepare(`
    SELECT product_key, pool_name, metric_name, api_path, biz_type, success_rate, duration_normal_ratio, avg_duration
    FROM api_patrol_stats WHERE stat_date=?
  `).all(dataDate)
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
    const elbRows = [], eipVpcRows = []
    for (const raw of allRows) {
      if (String(raw.api_path || '').startsWith('/')) eipVpcRows.push(raw)
      else elbRows.push(raw)
    }
    if (eipVpcRows.length > 0) {
      requests.push({
        package: 'eip_vpc', pool,
        rows: eipVpcRows.map((r) => ({
          id: r.external_row_id == null ? '' : String(r.external_row_id),
          appId: r.app_id || '', requestId: r.request_id, requestMapping: r.api_path,
          userId: r.user_id, userName: r.user_name,
          bizCategory: r.biz_category || '', bizTarget: r.biz_target || '', bizNo: r.biz_no || '',
          result: String(r.is_success), executionTimeMillis: r.duration_ms == null ? '' : String(r.duration_ms),
          createTime: r.request_time, diagnoseResult: '',
        })),
      })
    }
    if (elbRows.length > 0) {
      requests.push({
        package: 'elb', pool,
        rows: elbRows.map((r) => {
          const [rt, ro] = String(r.api_path || '').split('/')
          return {
            id: r.external_row_id == null ? '' : String(r.external_row_id),
            requestId: r.request_id, userId: r.user_id,
            resourceType: rt || '', resourceOperation: ro || '',
            startTime: r.request_time, endTime: r.end_time || '',
            resultStatus: r.is_success === 1 ? 'SUCCESS' : 'FAILED',
            errorMessage: r.error_message || '',
            dailyReport: r.daily_report || '', realtimeReport: r.realtime_report || '',
            userName: r.user_name, executionTimeMillis: r.duration_ms == null ? '' : String(r.duration_ms),
            diagnoseResult: '',
          }
        }),
      })
    }
  }

  const groups = db.prepare(`
    SELECT g.*, d.final_conclusion, d.status AS diag_status, d.mcp_raw_response
    FROM api_patrol_failure_groups g
    LEFT JOIN api_patrol_diagnoses d ON d.failure_group_id = g.id
    WHERE g.group_date = ? OR (g.group_date >= ? AND g.updated_at >= datetime('now', '-2 days'))
       -- 11-26 拆类注：缺口语义已收窄（查无数据——诊断链路的锅）；「日志在但读不出」已迁
       -- 新 L1「产品可观测性不足」（待处理）——本行 converged 判定只收窄后的缺口语义组。
       OR g.product_action_status = '—' AND g.root_cause_l1 = '诊断能力缺口'
       OR (d.status = 'success' AND d.mcp_raw_response IS NOT NULL AND TRIM(d.mcp_raw_response) != ''
           AND g.updated_at >= datetime('now', '-2 days'))
  `).all(dataDate, windowStart).map((raw) => {
    const r = raw
    return {
      groupDate: r.group_date, productKey: r.product_key, poolName: r.pool_name,
      apiPath: r.api_path, userName: r.user_name, metricName: r.metric_name,
      firstRequestId: r.first_request_id, firstRequestTime: r.first_request_time,
      preCompressCount: r.pre_compress_count, suppressedRequestIds: r.suppressed_request_ids,
      customerType: r.customer_type,
      rootCauseL1: r.root_cause_l1, rootCauseL2: r.root_cause_l2,
      // 11-23 修复：组状态随包透传（与 plan-c-daily 同步——豁免 '—' 防部署端重映射丢失）
      productAction: r.product_action_status == null ? null : String(r.product_action_status),
      finalConclusion: r.final_conclusion,
      // 11-20 19:23 拍板：MCP 原始日志全文随包推（与 plan-c-daily 同步——抽屉「查看完整日志」数据源）
      mcpRawResponse: r.mcp_raw_response == null ? null : String(r.mcp_raw_response),
      diagnosisStatus: r.product_action_status === '—' && r.root_cause_l1 === '诊断能力缺口'
        ? 'converged'
        : (r.diag_status === 'success' ? 'success' : 'failed'),
    }
  })

  return { date: dataDate, fetchedAt: new Date().toISOString(), stats: [...statsByProduct.entries()].map(([productKey, rows]) => ({ productKey, rows })), requests, groups }
}

async function main() {
  // targetDates 参数化（11-20 20:12）：默认原五天；PUSH_DATES=逗号分隔覆盖（补推全量历史用）；
  // 定向补跑（REDIAGNOSE_EMPTY_RAW）时若未显式指定，自动覆盖本机库全部有组的日期
  const { getDb, closeDb } = await import('../server/db.js')
  getDb()
  const { initBusinessSchema } = await import('../server/businessDb.js')
  initBusinessSchema()
  const db = getDb()
  let targetDates = (process.env.PUSH_DATES || '').split(',').map((s) => s.trim()).filter(Boolean)
  if (targetDates.length === 0 && REDIAGNOSE_EMPTY_RAW) {
    targetDates = db.prepare('SELECT DISTINCT group_date FROM api_patrol_failure_groups ORDER BY group_date').all().map((r) => String(r.group_date))
    log(`定向补跑：自动覆盖本机库全部日期 ${targetDates[0]} ~ ${targetDates[targetDates.length - 1]}（${targetDates.length} 天）`)
  }
  if (targetDates.length === 0) targetDates = ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
  const { compressPatrolDay } = await import('../server/patrolCompress.js')

  /** @type {{ date: string, groups: number, diagnosed: number, diagSucceeded: number, diagFailed: number, pushReceived?: number, pushError?: string }[]} */
  const results = []

  for (const dataDate of targetDates) {
    log(`--- ${dataDate} ---`)

    // ② 压缩——定向补推模式跳过（11-20 21:46 执行前预检发现）：compressPatrolDay 无条件
    // DELETE 当日池旧组再重建（组 id 变化），diagnoses 按 failure_group_id 关联会全部孤儿化——
    // 补推依赖的 139 组既有诊断记录（含 raw）将被拆断关联，白补且毁本机库。
    // 组已存在且带全诊断，重压缩纯害无利；默认模式（每日链语义：压缩→诊断→组包）保持原样。
    let totalGroups = 0
    if (REDIAGNOSE_EMPTY_RAW) {
      const existing = db.prepare('SELECT COUNT(*) c FROM api_patrol_failure_groups WHERE group_date=?').get(dataDate).c
      log(`  compress: 跳过（定向补推——沿用既有 ${existing} 组，防 DELETE 重建拆断诊断关联）`)
    } else {
      const pools = [...new Set(db.prepare('SELECT DISTINCT pool_name AS p FROM api_patrol_requests WHERE request_date=?').all(dataDate).map((r) => String(r.p)))]
      for (const pool of pools) {
        const r = compressPatrolDay(dataDate, pool)
        totalGroups += r.groups
        log(`  compress ${pool}: ${r.groups} 组（压缩自 ${r.compressedFrom} 失败行）`)
      }
    }

    // ③ 诊断（可选跳过）
    let diagResult = { total: 0, succeeded: 0, failed: 0 }
    if (!SKIP_DIAGNOSE && MCP_TOKEN) {
      diagResult = await runDiagnose(db, dataDate)
      log(`  diagnose: ${diagResult.total} 组，成功 ${diagResult.succeeded} / 失败 ${diagResult.failed}`)
    } else {
      log(`  diagnose: 跳过${SKIP_DIAGNOSE ? '（--skip-diagnose）' : '（缺 MCP token）'}`)
    }

    // ④ 组包
    const pkg = await buildPackageFor(db, dataDate)
    const statsRows = pkg.stats.reduce((a, s) => a + s.rows.length, 0)
    const reqRows = pkg.requests.reduce((a, r) => a + r.rows.length, 0)
    log(`  package: stats ${statsRows} 行 / requests ${reqRows} 行 / groups ${pkg.groups.length} 组`)

    // ⑤ 推送
    if (!DRY_RUN) {
      const pushResult = await pushPackage(pkg)
      if (pushResult.ok) {
        log(`  push: ✅ received ${pushResult.summary.received}`)
        results.push({
          date: dataDate, groups: totalGroups,
          diagnosed: diagResult.total, diagSucceeded: diagResult.succeeded, diagFailed: diagResult.failed,
          pushReceived: pushResult.summary.received,
        })
      } else {
        log(`  push: ❌ ${pushResult.error}`)
        results.push({
          date: dataDate, groups: totalGroups,
          diagnosed: diagResult.total, diagSucceeded: diagResult.succeeded, diagFailed: diagResult.failed,
          pushError: pushResult.error,
        })
      }
    } else {
      log(`  push: dry-run 跳过`)
      results.push({
        date: dataDate, groups: totalGroups,
        diagnosed: diagResult.total, diagSucceeded: diagResult.succeeded, diagFailed: diagResult.failed,
      })
    }
  }

  closeDb()

  log('========================================')
  log('汇总:')
  for (const r of results) {
    const diag = r.diagnosed > 0 ? ` 诊断 ${r.diagSucceeded || 0}/${r.diagnosed}` : ' 诊断 跳过'
    const push = r.pushReceived != null ? ` 推送 ✅ ${r.pushReceived}` : r.pushError ? ` 推送 ❌ ${r.pushError}` : ' 推送 dry-run'
    log(`  ${r.date}: ${r.groups} 组${diag}${push}`)
  }
  log('完成。')
}

main().catch((err) => {
  console.error('[push-hist] fatal', err)
  process.exitCode = 2
})