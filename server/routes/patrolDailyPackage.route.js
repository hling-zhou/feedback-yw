/**
 * Plan C 日包接收端点（docs/DESIGN-API巡检.md §10.2-10.7，2026-11-10 设计+评审修正）。
 *
 * 本机 WorkBuddy 数据代理（scripts/plan-c-daily.mjs）跑完 拉取→压缩→诊断 后，
 * 将三段数据打包推送到本端点。部署环境退化为「接收 + 展示」。
 *
 * 核心语义：
 * - 三段 upsert 幂等（stats/requests 复用 patrolIngestion；groups 本端点实现）
 * - §10.3 人工状态保护：处理中/已处理组不被数据重推打回
 * - §10.4 日报包触发（fire-and-forget + lastPackageReportDate 同日幂等）
 * - §10.5 diagnosisStatus 三态：success（回填）/ failed（保持 pending）/ converged（收敛「—」）
 * - §10.7 断供可观测：lastPackageReceivedAt 写 email_ingestion state
 */
import { apiKeyHasScope } from '../apiKeyRepository.js'
import { logAuditFromRequest } from '../audit.js'
import { storageRepository } from '../storageRepository.js'
import { getDb } from '../db.js'
import { isValidPatrolDate } from '../patrolDomain.js'
import { ingestPatrolStats, ingestPatrolRequests, loadPatrolCatalogShared } from '../patrolIngestion.js'
import { sendPatrolDailyReport, readPatrolReportConfig, yesterdayStr } from '../patrolReportScheduler.js'

const PACKAGE_BODY_LIMIT = 32 * 1024 * 1024  // 日包整体上限 32MB（三段合计，评审#9 行数限制之外的字节防御）
const MAX_ROWS_PER_BATCH = 5000             // 每批行上限（与 /push/* 一致）
const MAX_TOTAL_ROWS = 50_000               // 日包总行上限（评审#9）
const DIAGNOSIS_STATUS_WHITELIST = /** @type {const} */ (['success', 'failed', 'converged'])

/** 人工流程态——这些状态不被数据重推打回（§10.3）。 */
const MANUAL_FLOW_STATUSES = new Set(['处理中', '已处理'])

/**
 * groups 段单行 upsert（人工状态保护 + converged 语义）。
 * finalConclusion 不落 groups 表（无该列——结论真源在 diagnoses 表，见下 upsertDiagnoses 强制附推）。
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} g
 * @returns {number} 1=插入/更新
 */
function upsertGroup(db, g) {
  const groupDate = String(g.groupDate || '')
  const productKey = String(g.productKey || '')
  const poolName = String(g.poolName || '')
  const apiPath = String(g.apiPath || '')
  const userName = String(g.userName || '')
  const firstRequestId = String(g.firstRequestId || '')
  const status = String(g.diagnosisStatus || 'failed')
  const rootCauseL1 = g.rootCauseL1 == null ? null : String(g.rootCauseL1)
  const rootCauseL2 = g.rootCauseL2 == null ? null : String(g.rootCauseL2)
  const now = new Date().toISOString()

  const existing = /** @type {{ product_action_status: string } | undefined} */ (
    db.prepare(`
      SELECT product_action_status FROM api_patrol_failure_groups
      WHERE group_date=? AND pool_name=? AND first_request_id=?
    `).get(groupDate, poolName, firstRequestId)
  )

  // §10.3 人工状态保护：人工流程态（处理中/已处理）不被打回——status/assignee/confirmed/feedback 全不碰
  let nextStatus
  if (existing && MANUAL_FLOW_STATUSES.has(existing.product_action_status)) {
    nextStatus = existing.product_action_status
  } else if (status === 'failed') {
    nextStatus = 'pending_diagnosis'
  } else if (status === 'converged') {
    nextStatus = '—'
  } else {
    nextStatus = rootCauseL1 === '诊断能力缺口' ? '—' : '待处理'
  }

  // 经办人默认值（§2.3）：新建组且需要产品侧处理时填 catalog owners.productManager[0].username
  let defaultAssignee = null
  if (!existing && nextStatus === '待处理') {
    const catalog = /** @type {{ products?: Array<{ key: string, owners?: { productManager?: Array<{ username: string }> } }> } | null} */ (
      storageRepository.getMeta('product_catalog_managed_v1')
    )
    const prod = (catalog?.products || []).find((p) => p.key === productKey)
    defaultAssignee = prod?.owners?.productManager?.[0]?.username || null
  }

  const upsert = db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2,
       product_action_status, assignee, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(group_date, product_key, pool_name, api_path, user_name, first_request_id)
    DO UPDATE SET
      pre_compress_count=excluded.pre_compress_count,
      suppressed_request_ids=excluded.suppressed_request_ids,
      customer_type=excluded.customer_type,
      root_cause_l1=excluded.root_cause_l1,
      root_cause_l2=excluded.root_cause_l2,
      product_action_status=excluded.product_action_status,
      updated_at=excluded.updated_at
  `)
  upsert.run(
    groupDate, productKey, poolName, apiPath, String(g.metricName || ''),
    userName, firstRequestId, String(g.firstRequestTime || ''),
    Number(g.preCompressCount) || 1, String(g.suppressedRequestIds || '[]'),
    String(g.customerType || ''), rootCauseL1, rootCauseL2,
    nextStatus, defaultAssignee, now, now,
  )
  return 1
}

/**
 * diagnoses 附推（组诊断原文可追溯——§10.3 表格注）。
 * 日包 groups[].finalConclusion 在此落库（diagnoses 表是结论真源——groups 表无该列）；
 * 无显式 diagnoses 数组时按包字段合成一条（success/failed/converged 三态映射）。
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} g
 */
function upsertDiagnoses(db, g) {
  const groupId = db.prepare(`
    SELECT id FROM api_patrol_failure_groups
    WHERE group_date=? AND pool_name=? AND first_request_id=?
  `).get(String(g.groupDate || ''), String(g.poolName || ''), String(g.firstRequestId || ''))
  if (!groupId) return
  // diagnoses 表无唯一约束——按 (组, requestId) 先删后插实现重推覆盖语义
  const del = db.prepare('DELETE FROM api_patrol_diagnoses WHERE failure_group_id=?')
  del.run(/** @type {any} */ (groupId).id)
  const insert = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, diagnosed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  const now = new Date().toISOString()
  const diags = Array.isArray(g.diagnoses) && g.diagnoses.length > 0
    ? g.diagnoses
    : [{
      requestId: g.firstRequestId,
      status: String(g.diagnosisStatus || 'failed') === 'failed' ? 'failed' : 'success',
      toolName: 'log_search',
      finalConclusion: g.finalConclusion == null ? null : String(g.finalConclusion),
      rootCauseL1: g.rootCauseL1 == null ? null : String(g.rootCauseL1),
      rootCauseL2: g.rootCauseL2 == null ? null : String(g.rootCauseL2),
    }]
  for (const d of diags) {
    if (!d || typeof d !== 'object') continue
    insert.run(
      /** @type {any} */ (groupId).id,
      String(d.requestId || g.firstRequestId || ''),
      String(d.status || 'success'),
      String(d.toolName || 'log_search'),
      d.mcpRawResponse == null ? null : String(d.mcpRawResponse),
      d.finalConclusion == null ? null : String(d.finalConclusion),
      d.rootCauseL1 == null ? null : String(d.rootCauseL1),
      d.rootCauseL2 == null ? null : String(d.rootCauseL2),
      d.diagnosedAt || now,
    )
  }
}

/** 读/写日包状态（断供可观测——挂在 email_ingestion state meta 上，§10.7）。 */
function touchPackageReceived() {
  const KEY = 'api_patrol_email_ingestion_state_v1'
  let state = {}
  try {
    const parsed = storageRepository.getMeta(KEY)
    if (parsed && typeof parsed === 'object') state = /** @type {any} */ (parsed)
  } catch { /* 忽略——写覆盖 */ }
  storageRepository.putMeta(KEY, {
    ...state,
    lastPackageReceivedAt: new Date().toISOString(),
  })
}

/**
 * 日报包触发（§10.4 fire-and-forget + 同日幂等）。
 * 返回 'sent' | 'skipped' | 'disabled'——不 await 发送（调用方 void）。
 */
function triggerDailyReportAfterPackage() {
  const KEY_STATE = 'api_patrol_daily_report_state_v1'
  const KEY_PKG_REPORT = 'api_patrol_daily_report_state_v1_package'
  const config = readPatrolReportConfig()
  if (!config.enabled) return 'disabled'

  const today = new Date()
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  // 同日幂等：包触发标记 或 日报调度已发（lastSentDate=今日）→ 跳过
  const pkgMarked = storageRepository.getMeta(KEY_PKG_REPORT)
  if (pkgMarked && typeof pkgMarked === 'object' && /** @type {any} */ (pkgMarked).lastPackageReportDate === todayStr) {
    return 'skipped'
  }
  try {
    const reportState = storageRepository.getMeta(KEY_STATE)
    if (reportState && typeof reportState === 'object' && /** @type {any} */ (reportState).lastSentDate === todayStr) {
      // 10:30 兜底已发过（包晚到场景——评审#3 接受不齐版）→ 标记本日已触发防后续重推再判
      storageRepository.putMeta(KEY_PKG_REPORT, { lastPackageReportDate: todayStr })
      return 'skipped'
    }
  } catch { /* state 读失败不阻塞触发 */ }

  storageRepository.putMeta(KEY_PKG_REPORT, { lastPackageReportDate: todayStr })
  // fire-and-forget（评审#6）：不 await，SMTP 慢/超时不拖端点响应
  void sendPatrolDailyReport({ trigger: 'package' }).catch(() => {})
  return 'sent'
}

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerPatrolDailyPackageRoutes(app) {
  const requirePatrolPushScope = async (request, reply) => {
    if (!request.apiKey || !apiKeyHasScope(request.apiKey, /** @type {'patrol:push'} */ ('patrol:push'))) {
      return reply.code(403).send({ error: '缺少 patrol:push 权限（API Key 需配置该 scope）' })
    }
    return undefined
  }

  app.post('/api/patrol/push/daily-package', {
    preHandler: requirePatrolPushScope,
    bodyLimit: PACKAGE_BODY_LIMIT,
  }, async (request, reply) => {
    const body = /** @type {{
      date?: string, fetchedAt?: string,
      stats?: Array<{ productKey?: string, rows?: Record<string, string>[] }>,
      requests?: Array<{ package?: string, pool?: string, rows?: Record<string, string>[] }>,
      groups?: Array<Record<string, unknown>>,
    }} */ (request.body || {})

    // ---------- 校验层
    if (!body.date || !Array.isArray(body.stats) || !Array.isArray(body.requests) || !Array.isArray(body.groups)) {
      return reply.code(400).send({ error: '缺少必填段：date / stats / requests / groups' })
    }
    if (!isValidPatrolDate(body.date)) {
      return reply.code(400).send({ error: `date 格式非法：${body.date}（要求 YYYY-MM-DD）` })
    }
    let totalRows = 0
    for (const s of body.stats) {
      if (!s?.productKey || !Array.isArray(s.rows)) {
        return reply.code(400).send({ error: 'stats 段需 productKey + rows' })
      }
      if (s.rows.length > MAX_ROWS_PER_BATCH) {
        return reply.code(413).send({ error: `stats 段 ${s.productKey} 行数超上限 ${MAX_ROWS_PER_BATCH}` })
      }
      totalRows += s.rows.length
    }
    for (const r of body.requests) {
      if (r?.package !== 'eip_vpc' && r?.package !== 'elb') {
        return reply.code(400).send({ error: `requests 段 package 非法：${r?.package}` })
      }
      if (!r?.pool) return reply.code(400).send({ error: 'requests 段需 pool' })
      if (!Array.isArray(r.rows)) return reply.code(400).send({ error: 'requests 段需 rows' })
      if (r.rows.length > MAX_ROWS_PER_BATCH) {
        return reply.code(413).send({ error: `requests 段 ${r.pool} 行数超上限 ${MAX_ROWS_PER_BATCH}` })
      }
      totalRows += r.rows.length
    }
    if (body.groups.length > 2000) {
      return reply.code(413).send({ error: `groups 段超上限 2000（当前 ${body.groups.length}）` })
    }
    totalRows += body.groups.length
    if (totalRows > MAX_TOTAL_ROWS) {
      return reply.code(413).send({ error: `日包总行数超上限 ${MAX_TOTAL_ROWS}（当前 ${totalRows}）` })
    }
    for (const g of body.groups) {
      const st = String(g?.diagnosisStatus || '')
      if (!DIAGNOSIS_STATUS_WHITELIST.includes(/** @type {any} */ (st))) {
        return reply.code(400).send({ error: `diagnosisStatus 非法：${st}（要求 success | failed | converged）` })
      }
    }

    // ---------- 三段 upsert
    const db = getDb()
    const statsSummary = { inserted: 0, overwritten: 0, ignored: 0 }
    for (const s of body.stats) {
      const r = ingestPatrolStats({ date: body.date, productKey: String(s.productKey), rows: s.rows })
      statsSummary.inserted += r.inserted
      statsSummary.overwritten += r.overwritten
      statsSummary.ignored += r.ignored
    }
    const requestsSummary = { inserted: 0, overwritten: 0, ignored: 0 }
    for (const r of body.requests) {
      const res = ingestPatrolRequests({
        date: body.date, pool: String(r.pool), pkg: /** @type {'eip_vpc' | 'elb'} */ (r.package), rows: r.rows,
      })
      requestsSummary.inserted += res.inserted
      requestsSummary.overwritten += res.overwritten
      requestsSummary.ignored += res.ignored
    }
    let groupsWritten = 0
    const writeGroups = db.transaction(() => {
      for (const g of body.groups) {
        upsertGroup(db, g)
        upsertDiagnoses(db, g)
        groupsWritten += 1
      }
    })
    writeGroups()

    // ---------- 断供可观测 + 日报包触发（fire-and-forget）
    touchPackageReceived()
    const reportAction = triggerDailyReportAfterPackage()

    logAuditFromRequest(request, 'api_patrol.push_daily_package', {
      date: body.date,
      fetchedAt: body.fetchedAt,
      stats: statsSummary.inserted + statsSummary.overwritten,
      requests: requestsSummary.inserted + requestsSummary.overwritten,
      groups: groupsWritten,
      reportAction,
    })

    return {
      received: totalRows,
      stats: statsSummary,
      requests: requestsSummary,
      groups: { written: groupsWritten },
      reportAction,
    }
  })
}
