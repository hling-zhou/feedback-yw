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
 * 规则表稳定哈希（11-25 规则表同步的冲突判据）：对 items 做键序无关的确定性序列化后哈希。
 * 用途：部署端把「当前副本」与「上次同步基线」对比——哈希一致 = 副本未被本地编辑。
 * 不用 crypto 摘要（meta JSON 体量小，稳定性优先，序列化字符串自身即可当指纹）。
 * @param {unknown[]} items
 * @returns {string}
 */
function hashStable(items) {
  const normalized = (Array.isArray(items) ? items : [])
    .map((r) => JSON.stringify(/** @type {any} */ (r) ?? null, Object.keys(/** @type {any} */ (r) || {}).sort()))
  normalized.sort()
  return JSON.stringify(normalized)
}

/**
 * groups 段单行 upsert（人工状态保护 + converged 语义）。
 * finalConclusion 不落 groups 表（无该列——结论真源在 diagnoses 表，见下 upsertDiagnoses 强制附推）。
 * 11-25 修复：返回组 id（RETURNING）供 upsertDiagnoses 直用——消灭其内部三元组键重复定位
 * （缺 user_name，同 (date,pool,reqId) 双用户组形态下诊断行错组——先例 reqId-c6ee62c2… 事故）。
 * 组身份只在此处解析一次（六元组唯一键），诊断落库不再二次解析。
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} g
 * @returns {number | null} 组 id（upsert 后 RETURNING；异常防御返回 null 时调用方跳过诊断附推）
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

  // 11-25 修复：保护查询补全六元组唯一键（与下方 upsert ON CONFLICT 同键）——
  // 旧三元组（缺 user_name）在双用户同 reqId 形态下会把别的组的人工状态错当本组，
  // 新组 pending 被误保护、状态错乱。键定义与唯一约束同源是结构保证，不靠同步约定。
  const existing = /** @type {{ product_action_status: string, assignee: string | null } | undefined} */ (
    db.prepare(`
      SELECT product_action_status, assignee FROM api_patrol_failure_groups
      WHERE group_date=? AND product_key=? AND pool_name=? AND api_path=? AND user_name=? AND first_request_id=?
    `).get(groupDate, productKey, poolName, apiPath, userName, firstRequestId)
  )

  // §10.3 人工状态保护：人工流程态（处理中/已处理）不被打回——status/assignee/confirmed/feedback 全不碰
  let nextStatus
  if (existing && MANUAL_FLOW_STATUSES.has(existing.product_action_status)) {
    nextStatus = existing.product_action_status
  } else if (status === 'failed') {
    nextStatus = 'pending_diagnosis'
  } else if (typeof g.productAction === 'string' && g.productAction.trim() !== '') {
    // 11-23 修复：包显式组状态优先（源端管线产物——豁免白名单的 '—' 曾被下方 L1 重映射
    // 丢成「待处理」，先例 cmic_sim×L7POLICY 组日报误报待产品侧处理）。白名单校验，
    // 非法值回退 L1 映射；旧包无此字段同样回退——向后兼容。
    const passed = String(g.productAction).trim()
    nextStatus = ['—', '待处理', '处理中', '已处理', 'pending_diagnosis'].includes(passed) ? passed
      : rootCauseL1 === '诊断能力缺口' ? '—' : '待处理'
  } else if (status === 'converged') {
    nextStatus = '—'
  } else {
    nextStatus = rootCauseL1 === '诊断能力缺口' ? '—' : '待处理'
  }

  // 经办人默认值（§2.3）：需要产品侧处理（待处理）且经办人空时填 catalog owners.productManager[0].username。
  // 11-11 扩展：已有组·待处理·空经办人也补——修复旧代码首建的存量组（如 11-10 的 32 组首建时无此逻辑）；
  // 人工流程态（处理中/已处理）在上面已保持原 status ≠ 待处理，天然不进此分支（§10.3 保护优先）。
  const existingAssigneeEmpty = !existing || existing.assignee == null || String(existing.assignee) === ''
  let defaultAssignee = null
  if (nextStatus === '待处理' && existingAssigneeEmpty) {
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
      assignee=CASE
        WHEN (assignee IS NULL OR assignee = '') AND excluded.assignee IS NOT NULL THEN excluded.assignee
        ELSE assignee END,
      updated_at=excluded.updated_at
    RETURNING id
  `)
  // 11-25 修复：RETURNING id——插入与冲突更新两路径都返回组 id（SQLite 3.35+ / better-sqlite3 9 实测支持），
  // 传给 upsertDiagnoses 消灭其内部定位查询（旧三元组键在双用户同 reqId 形态下诊断行错组）。
  const groupId = (/** @type {{ id: number } | undefined} */ (
    upsert.get(
      groupDate, productKey, poolName, apiPath, String(g.metricName || ''),
      userName, firstRequestId, String(g.firstRequestTime || ''),
      Number(g.preCompressCount) || 1, String(g.suppressedRequestIds || '[]'),
      String(g.customerType || ''), rootCauseL1, rootCauseL2,
      nextStatus, defaultAssignee, now, now,
    )
  ))?.id
  return typeof groupId === 'number' ? groupId : null
}

/**
 * diagnoses 附推（组诊断原文可追溯——§10.3 表格注）。
 * 日包 groups[].finalConclusion 在此落库（diagnoses 表是结论真源——groups 表无该列）；
 * 无显式 diagnoses 数组时按包字段合成一条（success/failed/converged 三态映射）。
 * 11-25 修复：组 id 由 upsertGroup（RETURNING）直传——组身份只解析一次（六元组唯一键），
 * 本函数不再二次定位。旧三元组定位键（缺 user_name）在双用户同 reqId 形态下把诊断行
 * 全写到先建组头上、另一组恒空（先例 reqId-c6ee62c2… 抽屉「结论空 vs AI 判定有值」矛盾）。
 * @param {import('better-sqlite3').Database} db
 * @param {Record<string, unknown>} g
 * @param {number} groupId upsertGroup 返回的组 id（同一事务内已 upsert 的组）
 */
function upsertDiagnoses(db, g, groupId) {
  if (!Number.isInteger(groupId)) return
  // diagnoses 表无唯一约束——按 (组, requestId) 先删后插实现重推覆盖语义
  const del = db.prepare('DELETE FROM api_patrol_diagnoses WHERE failure_group_id=?')
  del.run(groupId)
  const insert = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, suggestion, direct_cause, evidence, root_cause_source, diagnosed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      suggestion: g.suggestion == null ? null : String(g.suggestion),
      // 11-17 五段结构化（LLM 主路径产物直传——directCause/evidence 为 JSON 数组字符串）
      directCause: g.directCause == null ? null : String(g.directCause),
      evidence: g.evidence == null ? null : String(g.evidence),
      rootCauseSource: g.rootCauseSource == null ? null : String(g.rootCauseSource),
      // 11-20 19:23 拍板：MCP 原始日志全文随包推——兜底合成路径同透传（曾断供致抽屉完整日志空）
      mcpRawResponse: g.mcpRawResponse == null ? null : String(g.mcpRawResponse),
    }]
  for (const d of diags) {
    if (!d || typeof d !== 'object') continue
    insert.run(
      groupId,
      String(d.requestId || g.firstRequestId || ''),
      String(d.status || 'success'),
      String(d.toolName || 'log_search'),
      d.mcpRawResponse == null ? null : String(d.mcpRawResponse),
      d.finalConclusion == null ? null : String(d.finalConclusion),
      d.rootCauseL1 == null ? null : String(d.rootCauseL1),
      d.rootCauseL2 == null ? null : String(d.rootCauseL2),
      d.suggestion == null ? null : String(d.suggestion),
      d.directCause == null ? null : String(d.directCause),
      d.evidence == null ? null : String(d.evidence),
      d.rootCauseSource == null ? null : String(d.rootCauseSource),
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
        // 11-25 修复：upsertGroup 返回组 id（RETURNING）直传诊断附推——组身份单次解析，
        // 消灭 upsertDiagnoses 旧三元组定位键在双用户同 reqId 形态下的错位（先例 reqId-c6ee62c2…）。
        const groupId = upsertGroup(db, g)
        if (groupId != null) upsertDiagnoses(db, g, groupId)
        groupsWritten += 1
      }
    })
    writeGroups()

    // ---------- 11-24 B3：豁免白名单同步（可选段——旧包无此段不动部署端值）
    // 覆盖写走 putPatrolActionExemptions 同一归一层（normalizeRule + 缓存失效 + 审计）；
    // 部署端需求池过滤（patrolQuery notExempt）读的就是这份 meta——两端同值。
    let exemptionsWritten = 0
    if (body.exemptions && Array.isArray(body.exemptions.rules)) {
      const { putPatrolActionExemptions } = await import('../patrolActionExemptions.js')
      // 归一层返回 normalizeRule 过滤后的实际写入集（userName 空=非法行被滤）——计数用过滤后真值
      const written = putPatrolActionExemptions(body.exemptions.rules, { username: 'plan-c-package-sync' })
      exemptionsWritten = written.length
    }

    // ---------- 11-25 规则表同步（可选段——旧包无此段不动部署端值；冲突保护语义）
    // 架构事实：分类在本机跑批（读本机规则表），本机 = 唯一维护源；部署端副本只服务
    // 面板展示 + Plan B 重诊断路径。同步语义（与 B3 豁免白名单的裸覆盖不同）：
    //   - 部署端副本与上次同步基线一致（未被本地编辑）→ 覆盖（正常合流）
    //   - 副本偏离基线（部署端被单独编辑过）→ 跳过 + action='conflict' + 审计留痕——
    //     部署端编辑永不静默丢失；运营将其改动重新应用到本机（唯一维护源）后，
    //     下次日包自然带上去。冲突时包内规则不落库，不覆盖。
    let rootCauseRulesAction = 'absent'   // absent=旧包无段 | applied=覆盖 | conflict=跳过
    if (body.rootCauseRules && Array.isArray(body.rootCauseRules.items)) {
      const BASELINE_KEY = 'api_patrol_root_cause_rules_sync_baseline_v1'
      const RULES_KEY = 'api_patrol_root_cause_rules_v1'
      const incomingItems = body.rootCauseRules.items
      const incomingHash = hashStable(incomingItems)
      const baseline = storageRepository.getMeta(BASELINE_KEY)
      const baselineHash = baseline && typeof baseline === 'object' ? String(/** @type {any} */ (baseline).hash || '') : ''
      // 无基线（首次同步）视为「副本未被编辑」——基线不存在意味着部署端值来自种子/旧包，
      // 不构成运营编辑冲突。
      const currentRaw = storageRepository.getMeta(RULES_KEY)
      const currentHash = currentRaw && Array.isArray(/** @type {any} */ (currentRaw).items)
        ? hashStable(/** @type {any} */ (currentRaw).items) : ''
      // 包值与副本一致 = 人工已把部署端编辑合流回本机（或本机本就是同一值）→ 视为合流，
      // 直接刷新基线解除冲突死锁（先例：测试⑥步——副本≠基线但=包值的形态）。
      if (currentHash && currentHash === incomingHash) {
        rootCauseRulesAction = 'applied'
        storageRepository.putMeta(RULES_KEY, {
          version: 2, updatedAt: new Date().toISOString(), items: incomingItems,
        })
        storageRepository.putMeta(BASELINE_KEY, {
          hash: incomingHash, syncedAt: new Date().toISOString(),
        })
      } else if (baselineHash && currentHash && baselineHash !== currentHash) {
        rootCauseRulesAction = 'conflict'
      } else {
        storageRepository.putMeta(RULES_KEY, {
          version: 2, updatedAt: new Date().toISOString(), items: incomingItems,
        })
        storageRepository.putMeta(BASELINE_KEY, {
          hash: incomingHash, syncedAt: new Date().toISOString(),
        })
        rootCauseRulesAction = 'applied'
      }
      logAuditFromRequest(request, 'api_patrol.root_cause_rules_sync', {
        action: rootCauseRulesAction, rulesCount: incomingItems.length, date: body.date,
      })
    }

    // ---------- 断供可观测 + 日报包触发（fire-and-forget）
    touchPackageReceived()
    const reportAction = triggerDailyReportAfterPackage()

    logAuditFromRequest(request, 'api_patrol.push_daily_package', {
      date: body.date,
      fetchedAt: body.fetchedAt,
      stats: statsSummary.inserted + statsSummary.overwritten,
      requests: requestsSummary.inserted + requestsSummary.overwritten,
      groups: groupsWritten,
      exemptions: exemptionsWritten,   // 11-24 B3：白名单同步可观测（0=旧包无段）
      rootCauseRules: rootCauseRulesAction,   // 11-25：规则表同步可观测（absent/applied/conflict）
      reportAction,
    })

    return {
      received: totalRows,
      stats: statsSummary,
      requests: requestsSummary,
      groups: { written: groupsWritten },
      exemptions: { written: exemptionsWritten },
      rootCauseRules: { action: rootCauseRulesAction },   // 11-25：absent/applied/conflict（conflict=部署端编辑被保护，待人工合流）
      reportAction,
    }
  })
}
