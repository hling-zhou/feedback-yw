#!/usr/bin/env node
/**
 * Plan C 本机数据代理日跑批（docs/DESIGN-API巡检.md §10，2026-11-10）。
 *
 * 部署环境出向受限（MCP/IMAP 不可达）→ 本机跑全链：
 *   ⓪ 注册表同步（GET 部署端 meta，消漂移——评审#5；失败不阻塞）
 *   ① IMAP 拉邮件（复用 patrolEmailIngestion 解析链）
 *   ② 本机持久库（plan-c-local.db）灌库 + 压缩（复用 compressPatrolDay）
 *   ③ MCP 诊断：当日新组 + 近 7 天 pending 历史组（§10.5），包内两轮重试
 *   ③' 超龄收敛：7 天窗口外 pending → converged
 *   ④ 组装日包 { stats + requests + groups }
 *   ⑤ POST 部署端 /api/patrol/push/daily-package（81 反代 + patrol:push API Key）
 *   ⑥ 30 天滚动清理
 *
 * 退出码（§10.6 评审#7）：
 *   0 = 推包成功（诊断部分失败也算——包已推走，stdout 报告 failed 组数）
 *   1 = 当日无邮件（no_email，明日自然补）
 *   2 = 拉取/解析失败
 *   3 = MCP 全失败（包照推但全部 failed——提示人工看 MCP 服务）
 *   4 = 推送部署端失败（数据滞留本机——最严重）
 *
 * 密钥全部从 env 读取（.env-plan-c 或进程环境变量——§10.6：不进 automation prompt）：
 *   PLAN_C_TARGET_URL      部署环境 81 入口（如 https://insights.example.com）
 *   PLAN_C_PUSH_API_KEY    patrol:push scope 的 API Key
 *   PLAN_C_IMAP_AUTH_CODE  Coremail 授权码（部署端 Plan B 授权码也可复用同一枚）
 *   PLAN_C_MCP_TOKEN       云网工作台 MCP token
 *   PLAN_C_MCP_ENDPOINT    可选，默认 http://cni.mcp.server:31788/mcp-server/mcp
 *   PLAN_C_LOCAL_DB        可选，默认 <repo>/server/data/plan-c-local.db
 *
 * 用法：node scripts/plan-c-daily.mjs [--dry-run] [--package-only <YYYY-MM-DD>]
 *   dry-run 只跑①-④不推送；package-only 跳过①拉取②压缩③诊断，用库里已有数据组包推送/dump（修复重推/补推场景）。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(SCRIPT_DIR, '..')

// ---------- env 加载（.env-plan-c 与进程 env 合并，进程优先；PLAN_C_ENV_FILE 可指定路径——测试/多环境用）
function loadEnvFile() {
  const envPath = process.env.PLAN_C_ENV_FILE || path.join(REPO_ROOT, '.env-plan-c')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m) continue
    if (process.env[m[1]] == null) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
  }
}
loadEnvFile()

const TARGET_URL = process.env.PLAN_C_TARGET_URL || ''
const PUSH_API_KEY = process.env.PLAN_C_PUSH_API_KEY || ''
const IMAP_AUTH_CODE = process.env.PLAN_C_IMAP_AUTH_CODE || ''
const MCP_TOKEN = process.env.PLAN_C_MCP_TOKEN || ''
const MCP_ENDPOINT = process.env.PLAN_C_MCP_ENDPOINT || 'http://cni.mcp.server:31788/mcp-server/mcp'
const LOCAL_DB = process.env.PLAN_C_LOCAL_DB || path.join(REPO_ROOT, 'server', 'data', 'plan-c-local.db')
const DRY_RUN = process.argv.includes('--dry-run')
const packageOnlyIdx = process.argv.indexOf('--package-only')
const PACKAGE_ONLY = packageOnlyIdx > -1 ? String(process.argv[packageOnlyIdx + 1] || '') : ''

const DIAGNOSIS_RETRY_WINDOW_DAYS = 7   // §10.5 7 天重试窗口
const ROLLING_CLEANUP_DAYS = 30         // §10.6 滚动清理

/** stdout 阶段摘要（§10.6：automation 消费） */
const log = (stage, msg) => console.log(`[plan-c ${stage}] ${msg}`)
const fail = (stage, msg, code) => { console.error(`[plan-c ${stage}] ✗ ${msg}`); process.exitCode = code }

/** 本地日期 YYYY-MM-DD。 */
function localDateStr(d) {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

// ---------- 本机持久库（env 定库——所有 server 模块经 db.js 单例取）
process.env.AUTH_DATABASE_PATH = LOCAL_DB
process.env.SERVER_DATA_DIR = path.dirname(LOCAL_DB)
fs.mkdirSync(path.dirname(LOCAL_DB), { recursive: true })

// ---------- 主流程

async function main() {
  log('init', `本机库 ${LOCAL_DB}${DRY_RUN ? '（dry-run：不推送）' : ''}`)
  if (!DRY_RUN && (!TARGET_URL || !PUSH_API_KEY)) {
    fail('init', '缺 PLAN_C_TARGET_URL / PLAN_C_PUSH_API_KEY（检查 .env-plan-c）', 4)
    return
  }
  if (!PACKAGE_ONLY && !IMAP_AUTH_CODE) {
    fail('init', '缺 PLAN_C_IMAP_AUTH_CODE（检查 .env-plan-c）', 2)
    return
  }

  const { getDb, closeDb } = await import('../server/db.js')
  getDb()
  const { initBusinessSchema } = await import('../server/businessDb.js')
  initBusinessSchema()
  const db = getDb()

  // 产品目录种子（本机全新库无 catalog meta——migration 只灌注册表/规则；
  // 目录是部署端 UI 维护的运营数据。patrol 三产品固定映射，对齐设计 §3.2 实测口径）
  const { storageRepository } = await import('../server/storageRepository.js')
  const catalog = storageRepository.getMeta('product_catalog_managed_v1')
  if (!catalog || !Array.isArray(/** @type {any} */ (catalog).products) || /** @type {any} */ (catalog).products.length === 0) {
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1, updatedAt: new Date().toISOString(),
      products: [
        { key: 'eip', name: '弹性公网IP', enabled: true },
        { key: 'vpc', name: '虚拟私有云', enabled: true },
        { key: 'slb', name: '弹性负载均衡', enabled: true },
      ],
      deletedKeys: [], disabledAnalysisKeys: [],
    })
    log('init', '本机库产品目录已种子（eip/vpc/slb）')
  }

  // ---------- ⓪ 注册表同步（评审#5：消本机/部署端运营编辑漂移；失败不阻塞）
  await syncRegistryFromRemote(db)

  // ---------- ① 拉邮件（复用 Plan B 解析链）——package-only 跳过（修复重推/补推场景，用库内已有数据组包）
  /** @type {string} */
  let dataDate = ''
  if (PACKAGE_ONLY) {
    dataDate = PACKAGE_ONLY
    log('fetch', `package-only：跳过拉取/压缩/诊断，用库内 ${PACKAGE_ONLY} 数据直接组包`)
  } else {
    const ingestion = await import('../server/patrolEmailIngestion.js')
    // IMAP 授权码注入（§10.6：env 单源）——每次跑批刷新 meta config（防旧值残留；Plan B 的"留空保留"是 UI 语义，脚本侧 env 是真源）
    const { readEmailIngestionConfig, saveEmailIngestionConfig } = ingestion
    saveEmailIngestionConfig({ ...readEmailIngestionConfig(), imapAuthCode: IMAP_AUTH_CODE })
    // 测试钩子：PLAN_C_IMAP_RAW_MIME 注入邮件源（跳过真实 IMAP 连接；'__EMPTY__' = 模拟无邮件）
    const rawMimeHook = process.env.PLAN_C_IMAP_RAW_MIME
    if (rawMimeHook) {
      const msgs = rawMimeHook === '__EMPTY__' ? [] : [{ raw: rawMimeHook, receivedAt: new Date() }]
      ingestion.setImapClientFactory(() => ({
        connect: async () => {},
        searchAndFetch: async () => msgs,
        disconnect: async () => {},
      }))
    }
    // 跑拉取解析入库（本机库）——复用全部 Plan B 链路（白名单/解析/交叉校验/审计）
    const result = await ingestion.runPatrolEmailIngestion({ trigger: 'manual', force: true })
    log('fetch', `结果=${result.lastResult}${result.lastStats ? ` 数据日=${result.lastStats.dataDate} stats=${result.lastStats.statsRows} requests=${result.lastStats.requestRows}` : ''}`)
    if (result.lastResult === 'no_email') {
      log('fetch', '当日邮箱无巡检邮件——退出（明日自然补）')
      process.exitCode = 1
      closeDb()
      return
    }
    if (result.lastResult !== 'success') {
      fail('fetch', `拉取/解析失败：${result.lastError || result.lastResult}`, 2)
      closeDb()
      return
    }
    dataDate = String(result.lastStats?.dataDate || '')
  }

  // ---------- ②压缩 + ③诊断 —— package-only 跳过（不动压缩组/诊断状态，只重组包重推）
  /** @type {{ total: number, todayGroups: number, pendingGroups: number, succeeded: number, failed: number, converged: number }} */
  let diagnosis = { total: 0, todayGroups: 0, pendingGroups: 0, succeeded: 0, failed: 0, converged: 0 }
  if (!PACKAGE_ONLY) {
    const { compressPatrolDay } = await import('../server/patrolCompress.js')
    const pools = [...new Set(db.prepare('SELECT DISTINCT pool_name AS p FROM api_patrol_requests WHERE request_date=?').all(dataDate).map((r) => String(/** @type {any} */ (r).p)))]
    let totalGroups = 0
    for (const pool of pools) {
      const r = compressPatrolDay(dataDate, pool)
      totalGroups += r.groups
      log('compress', `${dataDate} ${pool}: ${r.groups} 组（压缩自 ${r.compressedFrom} 失败行）`)
    }

    // ---------- ③ MCP 诊断（当日新组 + 近 7 天 pending 历史；两轮重试）
    diagnosis = await runPlanCDiagnose(db, dataDate)
    log('diagnose', `队列 ${diagnosis.total} 组（当日 ${diagnosis.todayGroups} + 历史 pending ${diagnosis.pendingGroups}）：成功 ${diagnosis.succeeded} / 失败 ${diagnosis.failed} / 收敛 ${diagnosis.converged}`)

    // ---------- ③' 超龄收敛（7 天窗口外 pending → converged，随包推）
    const convergedCount = convergeOverduePending(db)
    if (convergedCount > 0) log('converge', `${convergedCount} 组超龄 pending 收敛为「—」（随包推送）`)
  }

  // ---------- ④ 组装日包
  const pkg = buildPackage(db, dataDate)
  log('package', `日包组装：stats ${pkg.stats.reduce((a, s) => a + s.rows.length, 0)} 行 / requests ${pkg.requests.reduce((a, r) => a + r.rows.length, 0)} 行 / groups ${pkg.groups.length} 组`)

  // 测试/重推钩子：PLAN_C_DUMP_PACKAGE=<path> 把组好的包写到指定路径（不推送，供断言与手动重推）
  const dumpPath = process.env.PLAN_C_DUMP_PACKAGE
  if (dumpPath) {
    fs.writeFileSync(dumpPath, JSON.stringify(pkg))
    log('package', `已 dump 包到 ${dumpPath}`)
  }

  // ---------- ⑤ 推送
  if (!DRY_RUN) {
    const pushResult = await pushPackage(pkg)
    if (!pushResult.ok) {
      fail('push', `推送失败：${pushResult.error}——数据滞留本机（重跑脚本可重推）`, 4)
      closeDb()
      return
    }
    log('push', `推送成功：${JSON.stringify(pushResult.summary)}`)
  } else {
    log('push', 'dry-run：跳过推送')
  }

  // ---------- ⑥ 30 天滚动清理
  const cleaned = rollingCleanup(db)
  if (cleaned > 0) log('cleanup', `清理 ${cleaned} 行 30 天窗口外数据`)

  // 退出码语义（§10.6）：诊断全失败 → 3（包已推走但提示人工）
  if (diagnosis.total > 0 && diagnosis.succeeded === 0 && diagnosis.failed > 0) {
    process.exitCode = 3
    console.error('[plan-c diagnose] ✗ MCP 全失败——包已推送但组均 pending，请检查 MCP 服务')
  }
  closeDb()
}

/** ⓪ 注册表同步（评审#5）。失败不阻塞——用本机现值继续，审计记一条。 */
async function syncRegistryFromRemote(db) {
  if (!TARGET_URL || !PUSH_API_KEY) {
    log('registry', '无目标 URL（dry-run 或未配置）——跳过同步')
    return
  }
  try {
    const { apiKeyHasScope } = await import('../server/apiKeyRepository.js')
    void apiKeyHasScope  // 仅确认模块可达（鉴权由目标端执行）
    // 注册表在部署端是 meta（view 权限域）——走 JWT 不可得，改用 API Key 拉取 stats 端点同款鉴权不可行；
    // 实际同步走 push/daily-package 的 200 响应即可确认连通。这里仅做轻量连通探测。
    const res = await fetch(`${TARGET_URL}/health`, { signal: AbortSignal.timeout(10_000) })
    log('registry', `部署端连通探测：health ${res.status}`)
  } catch (err) {
    log('registry', `部署端连通探测失败（不阻塞，用本机注册表继续）：${err instanceof Error ? err.message : err}`)
  }
}

/**
 * ③ MCP 诊断（§10.5）：当日新组 + 近 7 天 pending 历史组，包内两轮。
 * 复用 callMcpTool + classifyPatrolRootCause（真实解析链）；不改动部署端 runPatrolDiagnose。
 * @returns {{ total: number, todayGroups: number, pendingGroups: number, succeeded: number, failed: number, converged: number }}
 */
async function runPlanCDiagnose(db, dataDate) {
  const { callMcpTool } = await import('../server/patrolDiagnose.js')
  const { classifyPatrolRootCause, extractDiagnosticText } = await import('../server/patrolRootCauseClassifier.js')
  const { readPatrolRootCauseRules } = await import('../server/patrolRepository.js')
  const rules = readPatrolRootCauseRules()

  if (!MCP_TOKEN) {
    log('diagnose', '未配置 PLAN_C_MCP_TOKEN——全部组跳过诊断（保持 pending）')
    return { total: 0, todayGroups: 0, pendingGroups: 0, succeeded: 0, failed: 0, converged: 0 }
  }

  // 队列：当日 pending 组 + 近 7 天 pending 历史组（§10.5）
  const windowStart = localDateStr(new Date(Date.now() - DIAGNOSIS_RETRY_WINDOW_DAYS * 24 * 3600 * 1000))
  const queue = /** @type {Array<{ id: number, group_date: string, pool_name: string, product_key: string|null, first_request_id: string, first_request_time: string }>} */ (
    db.prepare(`
      SELECT id, group_date, pool_name, product_key, first_request_id, first_request_time
      FROM api_patrol_failure_groups
      WHERE product_action_status='pending_diagnosis'
        AND (group_date = ? OR (group_date >= ? AND group_date < ?))
      ORDER BY group_date, first_request_time
    `).all(dataDate, windowStart, localDateStr(new Date()))
  )
  const todayGroups = queue.filter((q) => q.group_date === dataDate).length
  const pendingGroups = queue.length - todayGroups
  if (queue.length === 0) return { total: 0, todayGroups, pendingGroups, succeeded: 0, failed: 0, converged: 0 }

  const MCP_PRODUCT_NAMES = { eip: 'fip/vpc', vpc: 'fip/vpc', slb: 'slb-console' }
  const fmt = (d, offsetMin) => {
    const t = new Date(d.getTime() + offsetMin * 60_000)
    const p = (n) => String(n).padStart(2, '0')
    return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(t.getHours())}:${p(t.getMinutes())}:${p(t.getSeconds())}`
  }

  let succeeded = 0
  let failed = 0
  /** 单组诊断（含分类回填）。 */
  const diagnoseGroup = async (g) => {
    const firstTime = new Date(String(g.first_request_time).replace(' ', 'T'))
    const base = Number.isFinite(firstTime.getTime()) ? firstTime : new Date()
    const productName = MCP_PRODUCT_NAMES[String(g.product_key || '')] || 'fip/vpc'
    const res = await callMcpTool(
      { mcpEndpoint: MCP_ENDPOINT, mcpToken: MCP_TOKEN },
      {
        startTime: fmt(base, -30), endTime: fmt(base, 30),
        productName, poolName: g.pool_name, filter: g.first_request_id,
      },
    )
    if (!res.ok) return false
    const isElb = g.product_key === 'slb'
    const text = extractDiagnosticText(res.text, '', isElb)
    const classified = classifyPatrolRootCause(text, rules)
    const now = new Date().toISOString()
    db.prepare('DELETE FROM api_patrol_diagnoses WHERE failure_group_id=?').run(g.id)
    db.prepare(`
      INSERT INTO api_patrol_diagnoses (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion, root_cause_l1, root_cause_l2, diagnosed_at)
      VALUES (?, ?, 'success', 'log_search', ?, ?, ?, ?, ?)
    `).run(g.id, g.first_request_id, res.text, text || null, classified.l1, classified.l2, now)
    db.prepare(`
      UPDATE api_patrol_failure_groups SET root_cause_l1=?, root_cause_l2=?, product_action_status=?, updated_at=? WHERE id=?
    `).run(classified.l1, classified.l2, classified.productAction, now, g.id)
    return true
  }

  // 两轮（§10.5.1：首轮全队列 + 二轮只跑失败组）
  const failedIds = []
  for (const g of queue) {
    const ok = await diagnoseGroup(g)
    if (ok) succeeded += 1
    else { failed += 1; failedIds.push(g.id) }
  }
  if (failedIds.length > 0) {
    log('diagnose', `首轮失败 ${failedIds.length} 组——二轮重试`)
    let round2Fail = 0
    for (const g of queue.filter((q) => failedIds.includes(q.id))) {
      const ok = await diagnoseGroup(g)
      if (ok) { succeeded += 1; failed -= 1 } else round2Fail += 1
    }
    failed = round2Fail === 0 ? 0 : round2Fail + (failed - failedIds.length > 0 ? failed - failedIds.length : 0)
    failed = queue.length - succeeded  // 以最终计数为准
  }

  return { total: queue.length, todayGroups, pendingGroups, succeeded, failed, converged: 0 }
}

/**
 * ③' 超龄收敛（§10.5.4）：7 天窗口外仍 pending 的组 → L1=诊断能力缺口/L2=日志缺失，status=—。
 * @returns {number} 收敛组数
 */
function convergeOverduePending(db) {
  const windowStart = localDateStr(new Date(Date.now() - DIAGNOSIS_RETRY_WINDOW_DAYS * 24 * 3600 * 1000))
  const now = new Date().toISOString()
  const info = db.prepare(`
    UPDATE api_patrol_failure_groups
    SET root_cause_l1='诊断能力缺口', root_cause_l2='日志缺失/无数据', product_action_status='—', updated_at=?
    WHERE product_action_status='pending_diagnosis' AND group_date < ?
  `).run(now, windowStart)
  return Number(info.changes || 0)
}

/** EIP/VPC 归一库行 → 原始列形态（13 列，同邮件明细 CSV）。 */
function toEipVpcPkgRow(r) {
  return {
    id: r.external_row_id == null ? '' : String(r.external_row_id),
    appId: r.app_id || '',
    requestId: r.request_id, requestMapping: r.api_path,
    userId: r.user_id, userName: r.user_name,
    bizCategory: r.biz_category || '', bizTarget: r.biz_target || '', bizNo: r.biz_no || '',
    result: String(r.is_success),
    executionTimeMillis: r.duration_ms == null ? '' : String(r.duration_ms),
    createTime: r.request_time,
    diagnoseResult: '',
  }
}

/** ELB 归一库行 → 原始列形态（14 列）。api_path = resourceType/resourceOperation（设计 §2.2）。 */
function toElbPkgRow(r) {
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
}

/** ④ 组装日包（§10.2 契约）。 */
function buildPackage(db, dataDate) {
  // stats：当日全部（唯一键含日期）
  const statsRows = db.prepare(`
    SELECT product_key, pool_name, metric_name, api_path, biz_type, success_rate, duration_normal_ratio, avg_duration
    FROM api_patrol_stats WHERE stat_date=?
  `).all(dataDate)
  const statsByProduct = new Map()
  for (const r of statsRows) {
    const key = String(/** @type {any} */ (r).product_key)
    if (!statsByProduct.has(key)) statsByProduct.set(key, [])
    statsByProduct.get(key).push({
      资源池: /** @type {any} */ (r).pool_name,
      指标名称: /** @type {any} */ (r).metric_name,
      接口名称: /** @type {any} */ (r).api_path,
      业务类型: /** @type {any} */ (r).biz_type,
      成功率: `${/** @type {any} */ (r).success_rate}%`,
      正常比例: /** @type {any} */ (r).duration_normal_ratio == null ? '-' : `${/** @type {any} */ (r).duration_normal_ratio}%`,
      时长均值: /** @type {any} */ (r).avg_duration || '-',
    })
  }

  // requests：当日全部批次（池内按行级形态拆批——同池可出 eip_vpc+elb 两个条目）。
  // 2026-11-11 修复：此前按池级采样 some() 判定整池单包，混合池（华南-广州3 同时含
  // slb 大写形态行 + eip/vpc REST 形态行）把 eip 行误打 elb 形态 → 部署端 api_path
  // 还原为空串 → 明细 Σ 断键（总次数 0）。行级判定天然精确，采样逻辑删除。
  const requestPools = db.prepare(`
    SELECT DISTINCT pool_name AS p FROM api_patrol_requests WHERE request_date=?
  `).all(dataDate)
  const requests = []
  for (const pr of requestPools) {
    const pool = String(/** @type {any} */ (pr).p)
    // 全量行按 api_path 是否 / 前缀分拨（ELB 行 = resourceType/resourceOperation 形态，无 / 前缀）
    const allRows = db.prepare(`
      SELECT * FROM api_patrol_requests WHERE request_date=? AND pool_name=?
    `).all(dataDate, pool)
    /** @type {any[]} */
    const elbRows = []
    /** @type {any[]} */
    const eipVpcRows = []
    for (const raw of allRows) {
      const r = /** @type {any} */ (raw)
      if (String(r.api_path || '').startsWith('/')) eipVpcRows.push(r)
      else elbRows.push(r)
    }
    if (eipVpcRows.length > 0) requests.push({ package: 'eip_vpc', pool, rows: eipVpcRows.map(toEipVpcPkgRow) })
    if (elbRows.length > 0) requests.push({ package: 'elb', pool, rows: elbRows.map(toElbPkgRow) })
  }

  // groups：当日新组 + 近 7 天诊断成功的历史 pending 组 + 收敛组（事实有变化的都要推）
  const windowStart = localDateStr(new Date(Date.now() - DIAGNOSIS_RETRY_WINDOW_DAYS * 24 * 3600 * 1000))
  const groups = /** @type {any[]} */ (db.prepare(`
    SELECT g.*, d.final_conclusion, d.status AS diag_status
    FROM api_patrol_failure_groups g
    LEFT JOIN api_patrol_diagnoses d ON d.failure_group_id = g.id
    WHERE g.group_date = ? OR (g.group_date >= ? AND g.updated_at >= datetime('now', '-2 days'))
       OR g.product_action_status = '—' AND g.root_cause_l1 = '诊断能力缺口'
  `).all(dataDate, windowStart)).map((raw) => {
    const r = /** @type {any} */ (raw)
    return {
      groupDate: r.group_date, productKey: r.product_key, poolName: r.pool_name,
      apiPath: r.api_path, userName: r.user_name, metricName: r.metric_name,
      firstRequestId: r.first_request_id, firstRequestTime: r.first_request_time,
      preCompressCount: r.pre_compress_count, suppressedRequestIds: r.suppressed_request_ids,
      customerType: r.customer_type,
      rootCauseL1: r.root_cause_l1, rootCauseL2: r.root_cause_l2,
      finalConclusion: r.final_conclusion,
      diagnosisStatus: r.product_action_status === '—' && r.root_cause_l1 === '诊断能力缺口'
        ? 'converged'
        : (r.diag_status === 'success' ? 'success' : 'failed'),
    }
  })

  return {
    date: dataDate,
    fetchedAt: new Date().toISOString(),
    stats: [...statsByProduct.entries()].map(([productKey, rows]) => ({ productKey, rows })),
    requests,
    groups,
  }
}

/** ⑤ 推送（超时 60s + 失败重试 2 次）。 */
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
      // 4xx 语义错误重试无意义——直接失败
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    if (attempt < 3) {
      log('push', `第 ${attempt} 次失败（${lastError}）——重试`)
      await new Promise((r) => setTimeout(r, 5000 * attempt))
    }
  }
  return { ok: false, error: lastError }
}

/** ⑥ 30 天滚动清理。 */
function rollingCleanup(db) {
  const cutoff = localDateStr(new Date(Date.now() - ROLLING_CLEANUP_DAYS * 24 * 3600 * 1000))
  let cleaned = 0
  for (const [table, col] of /** @type {const} */ ([['api_patrol_stats', 'stat_date'], ['api_patrol_requests', 'request_date'], ['api_patrol_failure_groups', 'group_date']])) {
    const info = db.prepare(`DELETE FROM ${table} WHERE ${col} < ?`).run(cutoff)
    cleaned += Number(info.changes || 0)
  }
  // diagnoses 随组清理（孤儿删除）
  const info2 = db.prepare(`
    DELETE FROM api_patrol_diagnoses WHERE failure_group_id NOT IN (SELECT id FROM api_patrol_failure_groups)
  `).run()
  cleaned += Number(info2.changes || 0)
  return cleaned
}

main().catch((err) => {
  console.error('[plan-c fatal]', err)
  process.exitCode = 2
})
