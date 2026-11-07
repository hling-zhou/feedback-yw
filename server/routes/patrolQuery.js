/**
 * API 巡检溯源页查询与处理闭环 API（docs/DESIGN-API巡检.md §7.1）。
 * ①GET /api/patrol/failures/interfaces：异常接口列表（stats 驱动+明细 Σ 重算+跨日口径+<99.5 优先）
 * ②GET /api/patrol/failures/groups：失败请求列表（groups 直读+复合搜索 9 字段）
 * ③GET /api/patrol/failures/groups/:id：详情（组+诊断原文）
 * ④PATCH /api/patrol/failures/groups/:id：处理闭环（submit=已处理/draft=处理中；审计 before/after）
 * ⑤GET /api/patrol/cause-stats：总览聚合（byProductCause 双维度/dailyTrend 七类/metricTrends 缺天断线+补算/
 *   aiSummaryFacts + LLM 综述润色·失败模板降级）· docs §7.2
 */
import { requirePermission, requireAdmin } from '../middleware.js'
import { logAuditFromRequest } from '../audit.js'
import { getDb } from '../db.js'
import { resolveLlmApiKey, resolveLlmBaseUrl, resolveLlmModel } from '../llmConfig.js'
import { forwardLlmChatCompletion } from '../llmProxy.js'
import { getPatrolMcpConfigStatus, resolvePatrolMcpConfig } from '../patrolMcpConfig.js'
import { productNameMap } from '../patrolReportBuilder.js'
import {
  readPatrolReportConfig,
  readPatrolReportState,
  savePatrolReportConfig,
  sendPatrolDailyReport,
  META_KEY_PATROL_REPORT_CONFIG,
} from '../patrolReportScheduler.js'
import { getLlmCompletionText } from '../../src/lib/llmClient.js'

const PATROL_L1_SET = new Set([
  '业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败',
  '资源状态异常', '诊断能力缺口', '其他/未归类',
])

/**
 * @param {import('fastify').FastifyInstance} app
 */
export function registerPatrolQueryRoutes(app) {
  const parseRange = (query) => {
    const { date, startDate, endDate } = /** @type {{date?: string, startDate?: string, endDate?: string}} */ (query)
    if (date) return { start: date, end: date, single: true }
    const s = String(startDate || '')
    const e = String(endDate || '')
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s) || !/^\d{4}-\d{2}-\d{2}$/.test(e)) return null
    return { start: s, end: e, single: s === e }
  }

  // ①异常接口列表——计算逻辑抽为 computeFailureInterfaces（巡检概况 facts 与列表同源单源，2026-11-07 拍板）
  const computeFailureInterfaces = (range) => {
    const db = getDb()
    const PRODUCT_NAMES = productNameMap()
    const statsRows = db.prepare(`
      SELECT stat_date, product_key, pool_name, metric_name, api_path, biz_type, success_rate,
             duration_normal_ratio, avg_duration
      FROM api_patrol_stats
      WHERE stat_date BETWEEN ? AND ?
      ORDER BY success_rate ASC
    `).all(range.start, range.end)

    // 明细 Σ 重算（按 池×接口 聚合）
    const detailAgg = new Map()
    const rows = db.prepare(`
      SELECT request_date, pool_name, api_path, is_success, COUNT(*) n
      FROM api_patrol_requests
      WHERE request_date BETWEEN ? AND ?
      GROUP BY request_date, pool_name, api_path, is_success
    `).all(range.start, range.end)
    for (const r of rows) {
      const key = `${r.pool_name}\u0000${r.api_path}`
      if (!detailAgg.has(key)) detailAgg.set(key, { total: 0, fail: 0 })
      const agg = detailAgg.get(key)
      agg.total += Number(r.n)
      if (Number(r.is_success) === 0) agg.fail += Number(r.n)
    }

    // 输出行：stats 行为基（跨日同键聚合），挂重算次数
    /** @type {Array<Record<string, unknown>>} */
    const out = []
    const seen = new Map()
    for (const s of statsRows) {
      const key = `${s.pool_name}\u0000${s.api_path}`
      const agg = detailAgg.get(`${s.pool_name}\u0000${s.api_path}`) || { total: 0, fail: 0 }
      if (!range.single) {
        // 跨日：同键合并（简单写法规避 vite SSR transform 对 jsdoc-cast 表达式的错误转换）
        if (seen.has(key)) {
          const idx = Number(seen.get(key))
          const prev = out[idx]
          if (prev && Array.isArray(prev.statDates)) {
            prev.statDates.push(s.stat_date)
          }
          continue
        }
        seen.set(key, out.length)
        out.push({
          productKey: s.product_key, productName: PRODUCT_NAMES[s.product_key] || s.product_key,
          pool: s.pool_name, metricName: s.metric_name, apiPath: s.api_path, bizType: s.biz_type,
          successRate: null, // 跨日由明细 Σ 重算（下行覆盖）
          totalCount: agg.total, failCount: agg.fail,
          avgDuration: null, durationNormalRatio: null, // 跨日显示"—"（C 拍板）
          statDates: [s.stat_date],
        })
        continue
      }
      out.push({
        productKey: s.product_key, productName: PRODUCT_NAMES[s.product_key] || s.product_key,
        pool: s.pool_name, metricName: s.metric_name, apiPath: s.api_path, bizType: s.biz_type,
        successRate: agg.total > 0
          ? Math.round(((agg.total - agg.fail) / agg.total) * 10000) / 100
          : Number(s.success_rate),
        totalCount: agg.total, failCount: agg.fail,
        avgDuration: s.avg_duration, durationNormalRatio: s.duration_normal_ratio,
        statDates: [s.stat_date],
      })
    }
    // 跨日 Σ：合并同键后重算成功率；并推导仿真/测试标签（11-07 拍板：接口×池 窗口内失败组全为仿真/测试 → pureSim 带标签排后；混合真实客户的接口有真问题不后排）
    const simAgg = new Map()
    const simGroupRows = db.prepare(`
      SELECT pool_name, api_path, customer_type
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ?
    `).all(range.start, range.end)
    for (const g of simGroupRows) {
      const key = `${g.pool_name}\u0000${g.api_path}`
      if (!simAgg.has(key)) simAgg.set(key, { groups: 0, sim: 0 })
      const agg = simAgg.get(key)
      agg.groups += 1
      if (g.customer_type === '仿真' || g.customer_type === '测试账号') agg.sim += 1
    }
    for (const o of out) {
      if (o.statDates.length > 0 && !range.single && o.totalCount > 0) {
        o.successRate = Math.round(((o.totalCount - o.failCount) / o.totalCount) * 10000) / 100
      }
      const si = simAgg.get(`${o.pool}\u0000${o.apiPath}`) || { groups: 0, sim: 0 }
      o.simGroups = si.sim
      o.pureSim = si.groups > 0 && si.sim === si.groups
    }
    // 排序：仿真/测试标签行最后（11-07 拍板）→ <99.5% 优先在前，其余按序（拍板：展示全部<100%）
    out.sort((a, b) => {
      const pa = a.pureSim ? 1 : 0
      const pb = b.pureSim ? 1 : 0
      if (pa !== pb) return pa - pb
      const ra = a.successRate == null ? 100 : Number(a.successRate)
      const rb = b.successRate == null ? 100 : Number(b.successRate)
      const aLow = ra < 99.5 ? 0 : 1
      const bLow = rb < 99.5 ? 0 : 1
      if (aLow !== bLow) return aLow - bLow
      return ra - rb
    })
    return out
  }

  app.get('/api/patrol/failures/interfaces', { preHandler: requirePermission('view') }, async (request, reply) => {
    const range = parseRange(request.query)
    if (!range) return reply.code(400).send({ error: '缺少 date 或 startDate/endDate（YYYY-MM-DD）' })
    return { rows: computeFailureInterfaces(range) }
  })

  // ①'巡检概况 AI 总结（溯源页顶部，2026-11-07 拍板：检测结果概况——尤其异常情况；facts 与①列表同源）
  app.get('/api/patrol/failures/summary-facts', { preHandler: requirePermission('view') }, async (request, reply) => {
    const range = parseRange(request.query)
    if (!range) return reply.code(400).send({ error: '缺少 date 或 startDate/endDate（YYYY-MM-DD）' })
    const db = getDb()
    const rows = computeFailureInterfaces(range)
    const PRODUCT_NAMES = productNameMap()

    // 覆盖概况 + 阈值异常数 + 失败总量 + 最差 Top3（与异常接口列表同源——computeFailureInterfaces 单源）
    const distinctPools = new Set(rows.map((r) => r.pool))
    const distinctProducts = new Set(rows.map((r) => r.productKey))
    const belowThresholdCount = rows.filter((r) => Number.isFinite(Number(r.successRate)) && Number(r.successRate) < 99.5).length
    const failTotal = rows.reduce((a, r) => a + Number(r.failCount || 0), 0)
    const worstTop3 = rows.slice(0, 3).map((r) => ({
      productName: r.productName, pool: r.pool, apiPath: r.apiPath,
      successRate: r.successRate, failCount: r.failCount, pureSim: r.pureSim === true,
    }))

    // 最集中异常点（窗口内已诊断失败组按 产品×接口×L2 聚合，压缩前次数最大者；含仿真占比标注）
    const focusRows = db.prepare(`
      SELECT product_key pk, api_path, root_cause_l2 l2, SUM(pre_compress_count) pre, COUNT(*) groups,
             SUM(CASE WHEN customer_type IN ('仿真','测试账号') THEN pre_compress_count ELSE 0 END) simPre
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL
      GROUP BY product_key, api_path, root_cause_l2
      ORDER BY pre DESC LIMIT 1
    `).all(range.start, range.end)
    const focus = focusRows.length ? {
      productName: PRODUCT_NAMES[focusRows[0].pk] || focusRows[0].pk,
      apiPath: String(focusRows[0].api_path || ''), causeL2: String(focusRows[0].l2 || ''),
      pre: Number(focusRows[0].pre || 0), groups: Number(focusRows[0].groups || 0),
      simPre: Number(focusRows[0].simPre || 0),
    } : null

    // 根因 Top3（窗口内已诊断组 L1 占比）+ 闭环状态 + 仿真/未诊断
    const l1Rows = db.prepare(`
      SELECT root_cause_l1 l1, COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL
      GROUP BY root_cause_l1 ORDER BY n DESC LIMIT 3
    `).all(range.start, range.end)
    const l1TotalRow = db.prepare(
      `SELECT COUNT(*) n FROM api_patrol_failure_groups WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL`,
    ).get(range.start, range.end)
    const l1Total = Number(l1TotalRow?.n || 0)
    const causeTop3 = l1Rows.map((r) => ({
      l1: String(r.l1 || ''), count: Number(r.n),
      ratio: l1Total > 0 ? Math.round((Number(r.n) * 100) / l1Total) : 0,
    }))
    const stateRows = db.prepare(`
      SELECT product_action_status status, COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? GROUP BY product_action_status
    `).all(range.start, range.end)
    /** @type {Record<string, number>} */
    const stateMap = {}
    for (const s of stateRows) stateMap[String(s.status)] = Number(s.n)
    const undiagnosedRow = db.prepare(
      `SELECT COUNT(*) n FROM api_patrol_failure_groups WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NULL`,
    ).get(range.start, range.end)
    const simGroupsRow = db.prepare(
      `SELECT COUNT(*) n FROM api_patrol_failure_groups WHERE group_date BETWEEN ? AND ? AND customer_type IN ('仿真','测试账号')`,
    ).get(range.start, range.end)

    // 环比（上一等长窗口，本地日期计算——toISOString 会偏移）
    const days = Math.round((new Date(`${range.end}T00:00:00`).getTime() - new Date(`${range.start}T00:00:00`).getTime()) / 86400000) + 1
    const fmt = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    /** @type {{prevFailTotal: number, prevInterfaceCount: number, failDelta: number, interfaceDelta: number} | null} */
    let delta = null
    if (days >= 1 && days <= 92) {
      const prevEnd = new Date(new Date(`${range.start}T00:00:00`).getTime() - 86400000)
      const prevStart = new Date(prevEnd.getTime() - (days - 1) * 86400000)
      const prevRows = computeFailureInterfaces({ start: fmt(prevStart), end: fmt(prevEnd), single: days === 1 })
      const prevFail = prevRows.reduce((a, r) => a + Number(r.failCount || 0), 0)
      delta = {
        prevFailTotal: prevFail, prevInterfaceCount: prevRows.length,
        failDelta: failTotal - prevFail, interfaceDelta: rows.length - prevRows.length,
      }
    }

    const facts = {
      window: { start: range.start, end: range.end, days },
      productCount: distinctProducts.size,
      poolCount: distinctPools.size,
      interfaceCount: rows.length,
      belowThresholdCount,
      failTotal,
      worstTop3,
      focus,
      causeTop3,
      closure: {
        pending: stateMap['待处理'] || 0,
        processed: stateMap['已处理'] || 0,
        inProgress: stateMap['处理中'] || 0,
        notNeeded: stateMap['—'] || 0,
        undiagnosed: Number(undiagnosedRow?.n || 0),
        simGroups: Number(simGroupsRow?.n || 0),
      },
      delta,
    }
    const summary = await buildPatrolSummaryText(facts)
    return { facts, summary }
  })

  // ②失败请求列表（复合搜索）
  app.get('/api/patrol/failures/groups', { preHandler: requirePermission('view') }, async (request, reply) => {
    const range = parseRange(request.query)
    if (!range) return reply.code(400).send({ error: '缺少 startDate/endDate' })
    const q = /** @type {Record<string, string>} */ (request.query)
    const db = getDb()
    /** @type {string[]} */
    const where = ['g.group_date BETWEEN ? AND ?']
    /** @type {Array<string | number>} */
    const params = [range.start, range.end]
    if (q.product) { where.push('g.product_key = ?'); params.push(q.product) }
    if (q.metricName) { where.push('g.metric_name LIKE ?'); params.push(`%${q.metricName}%`) }
    if (q.apiPath) { where.push('g.api_path LIKE ?'); params.push(`%${q.apiPath}%`) }
    if (q.requestId) { where.push('(g.first_request_id LIKE ? OR g.suppressed_request_ids LIKE ?)'); params.push(`%${q.requestId}%`, `%${q.requestId}%`) }
    if (q.userName) { where.push('g.user_name LIKE ?'); params.push(`%${q.userName}%`) }
    if (q.rootCauseL1) { where.push('g.root_cause_l1 = ?'); params.push(q.rootCauseL1) }
    if (q.rootCauseL2) { where.push('g.root_cause_l2 = ?'); params.push(q.rootCauseL2) }
    if (q.customerType) { where.push('g.customer_type = ?'); params.push(q.customerType) }
    if (q.assignee) { where.push('g.assignee = ?'); params.push(q.assignee) }
    if (q.status) {
      if (q.status === '未诊断') { where.push(`g.product_action_status = 'pending_diagnosis'`) }
      else { where.push('g.product_action_status = ?'); params.push(q.status) }
    }
    if (q.minPreCount) { where.push('g.pre_compress_count >= ?'); params.push(Number(q.minPreCount)) }
    const rows = db.prepare(`
      SELECT id, group_date AS groupDate, product_key AS productKey, pool_name AS poolName,
             api_path AS apiPath, metric_name AS metricName, user_name AS userName,
             first_request_id AS firstRequestId, first_request_time AS firstRequestTime,
             pre_compress_count AS preCompressCount, suppressed_request_ids AS suppressedRequestIds,
             customer_type AS customerType, root_cause_l1 AS rootCauseL1, root_cause_l2 AS rootCauseL2,
             product_action_status AS productActionStatus, assignee,
             root_cause_confirmed AS rootCauseConfirmed, measure_feedback AS measureFeedback,
             feedback_by AS feedbackBy, feedback_at AS feedbackAt
      FROM api_patrol_failure_groups g
      WHERE ${where.join(' AND ')}
      ORDER BY g.group_date DESC, g.first_request_time DESC
      LIMIT 500
    `).all(...params)
    return { rows }
  })

  // ③详情
  app.get('/api/patrol/failures/groups/:id', { preHandler: requirePermission('view') }, async (request, reply) => {
    const id = Number((/** @type {{id: string}} */ (request.params)).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 非法' })
    const db = getDb()
    const group = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE id=?`).get(id)
    if (!group) return reply.code(404).send({ error: '组不存在' })
    const diag = db.prepare(`
      SELECT request_id, status, tool_name, mcp_raw_response, final_conclusion,
             root_cause_l1, root_cause_l2, diagnosed_at
      FROM api_patrol_diagnoses WHERE failure_group_id=? ORDER BY id DESC LIMIT 1
    `).get(id)
    // 被压缩请求明细：从 suppressed_request_ids 展开
    /** @type {Array<Record<string, unknown>>} */
    const detailRows = []
    const g = /** @type {{first_request_id: string, suppressed_request_ids: string, pool_name: string, request_id?: string}} */ (group)
    const ids = [g.first_request_id, ...safeParseIds(g.suppressed_request_ids)]
    const reqQuery = db.prepare(`
      SELECT request_id, request_time, is_success, duration_ms, error_message
      FROM api_patrol_requests WHERE request_id = ?
    `)
    for (const rid of ids) {
      const r = reqQuery.get(rid)
      if (r) detailRows.push(r)
    }
    return {
      group: rowToCamel(group),
      diagnosis: diag ? rowToCamel(diag) : null,
      requests: detailRows.map((r) => rowToCamel(r)),
    }
  })

  // ④处理闭环 PATCH
  app.patch('/api/patrol/failures/groups/:id', { preHandler: requirePermission('manageTags') }, async (request, reply) => {
    const id = Number((/** @type {{id: string}} */ (request.params)).id)
    const body = /** @type {{action?: string, rootCauseConfirmed?: string, realRootCause?: string,
      measureFeedback?: string, assignee?: string}} */ (request.body || {})
    const db = getDb()
    const before = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE id=?`).get(id)
    if (!before) return reply.code(404).send({ error: '组不存在' })
    if (body.action !== 'submit' && body.action !== 'draft') {
      return reply.code(400).send({ error: 'action 必须 submit（提交）或 draft（暂存）' })
    }
    if (body.rootCauseConfirmed === '不属实' && !String(body.realRootCause || '').trim()) {
      return reply.code(400).send({ error: '根因不属实时必须填写真实根因' })
    }
    if (body.action === 'submit' && body.rootCauseConfirmed && !String(body.measureFeedback || '').trim()) {
      return reply.code(400).send({ error: '提交时必须填写举措及排期说明（不涉及也需说明）' })
    }
    const status = body.action === 'submit' ? '已处理' : '处理中'
    const now = new Date().toISOString()
    db.prepare(`
      UPDATE api_patrol_failure_groups SET
        product_action_status=?, root_cause_confirmed=COALESCE(?, root_cause_confirmed),
        measure_feedback=COALESCE(?, measure_feedback), assignee=COALESCE(?, assignee),
        feedback_by=?, feedback_at=?, updated_at=?
      WHERE id=?
    `).run(
      status,
      body.rootCauseConfirmed ?? null,
      body.measureFeedback ?? null,
      body.assignee ?? null,
      /** @type {{user?: {username?: string}}} */ (request.user)?.username || 'unknown',
      now, now, id,
    )
    const after = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE id=?`).get(id)
    logAuditFromRequest(request, 'api_patrol.group_update', {
      groupId: id,
      action: body.action,
      before: {
        productActionStatus: /** @type {{product_action_status: string}} */ (before).product_action_status,
        assignee: /** @type {{assignee: string | null}} */ (before).assignee,
        rootCauseConfirmed: /** @type {{root_cause_confirmed: string | null}} */ (before).root_cause_confirmed,
        measureFeedback: /** @type {{measure_feedback: string | null}} */ (before).measure_feedback,
      },
      after: {
        productActionStatus: /** @type {{product_action_status: string}} */ (after).product_action_status,
        assignee: /** @type {{assignee: string | null}} */ (after).assignee,
        rootCauseConfirmed: /** @type {{root_cause_confirmed: string | null}} */ (after).root_cause_confirmed,
        measureFeedback: /** @type {{measure_feedback: string | null}} */ (after).measure_feedback,
      },
      changedBy: /** @type {{user?: {username?: string}}} */ (request.user)?.username || 'unknown',
    })
    return { group: rowToCamel(after) }
  })

  // ⑥管理员显式触发：压缩 + 诊断（设计 §4.1——推送不自动触发，人工/脚本确认后执行）
  // 产品API日志诊断配置（脱敏读）：面板状态展示用；写入走 PUT /api/storage/meta/api_patrol_mcp_config_v1
  // （通用 meta GET 对该 key 禁明文，见 storage.js；镜像 GET /api/llm/config 的 view 权限+脱敏形态）
  app.get('/api/patrol/admin/mcp-config', { preHandler: requirePermission('view') }, async () => {
    return getPatrolMcpConfigStatus()
  })

  // ⑥AI巡检日报（docs §8）：配置前端面板维护；发送链见 patrolReportScheduler.js
  app.get('/api/patrol/report/config', { preHandler: requirePermission('view') }, async () => {
    return readPatrolReportConfig()
  })

  app.put('/api/patrol/report/config', { preHandler: requirePermission('manageTags') }, async (request, reply) => {
    const body = /** @type {{enabled?: boolean, groupIds?: string[], channelId?: string, sendTime?: string, includeQuiet?: boolean, excludeSimTagged?: boolean, maxInterfacesPerProduct?: number}} */ (request.body || {})
    const prev = readPatrolReportConfig()
    const next = {
      enabled: body.enabled === true,
      groupIds: Array.isArray(body.groupIds) ? body.groupIds.map((g) => String(g)) : [],
      channelId: typeof body.channelId === 'string' ? body.channelId : '',
      sendTime: typeof body.sendTime === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(body.sendTime) ? body.sendTime : '09:00',
      includeQuiet: body.includeQuiet !== false,
      excludeSimTagged: body.excludeSimTagged === true,
      maxInterfacesPerProduct: Number(body.maxInterfacesPerProduct) >= 5 && Number(body.maxInterfacesPerProduct) <= 100
        ? Math.round(Number(body.maxInterfacesPerProduct)) : 20,
    }
    savePatrolReportConfig(next)
    logAuditFromRequest(request, 'api_patrol.daily_report_config_update', {
      enabledChanged: prev.enabled !== next.enabled,
      groupCount: next.groupIds.length,
      channelId: next.channelId,
      sendTime: next.sendTime,
    })
    return { config: next }
  })

  app.post('/api/patrol/report/send', { preHandler: requirePermission('manageTags') }, async (request, reply) => {
    const body = /** @type {{force?: boolean}} */ (request.body || {})
    // 手动发送忽略 enabled 与当日幂等（立即发送=测试/补发）
    const result = await sendPatrolDailyReport({ trigger: 'manual', force: body.force === true })
    if (!result.ok) return reply.code(400).send({ error: result.error || '发送失败', ...result })
    return result
  })

  app.get('/api/patrol/report/status', { preHandler: requirePermission('view') }, async () => {
    return {
      enabled: readPatrolReportConfig().enabled,
      state: readPatrolReportState() || {},
    }
  })

  app.post('/api/patrol/admin/process', { preHandler: requireAdmin() }, async (request, reply) => {
    const body = /** @type {{dates?: string[], mcpEndpoint?: string, mcpToken?: string, runDiagnose?: boolean}} */ (request.body || {})
    const dates = Array.isArray(body.dates) ? body.dates.filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : []
    if (dates.length === 0) return reply.code(400).send({ error: 'dates 非空数组（YYYY-MM-DD）' })
    const db = getDb()
    const pools = [...new Set(db.prepare(`
      SELECT DISTINCT pool_name AS pool FROM api_patrol_requests WHERE request_date IN (${dates.map(() => '?').join(',')})
    `).all(...dates).map((r) => String(/** @type {{pool: string}} */ (r).pool)))]
    const { compressPatrolDay } = await import('../patrolCompress.js')
    /** @type {Array<{date: string, pool: string, groups: number, compressedFrom: number}>} */
    const compressLog = []
    for (const date of dates) {
      for (const pool of pools) {
        const r = compressPatrolDay(date, pool, { rebuild: true })
        compressLog.push({ date, pool, groups: r.groups, compressedFrom: r.compressedFrom })
      }
    }
    // 诊断（可选）：MCP 配置解析链 = 显式传参（测试覆盖用）> 库配置（Settings「产品API日志诊断配置」面板）> 环境变量
    /** @type {Array<{date: string, pool: string, diagnosed: number, succeeded: number, failed: number}>} */
    const diagnoseLog = []
    if (body.runDiagnose) {
      const mcp = body.mcpEndpoint
        ? { mcpEndpoint: String(body.mcpEndpoint), mcpToken: String(body.mcpToken || '') }
        : resolvePatrolMcpConfig()
      if (mcp.mcpEndpoint) {
        const { runPatrolDiagnose } = await import('../patrolDiagnose.js')
        for (const date of dates) {
          for (const pool of pools) {
            const r = await runPatrolDiagnose({
              date, pool,
              mcpEndpoint: mcp.mcpEndpoint,
              mcpToken: mcp.mcpToken,
              timeoutMs: 30_000, concurrency: 3,
            })
            diagnoseLog.push({ date, pool, ...r })
          }
        }
      }
    }
    logAuditFromRequest(request, 'api_patrol.admin_process', {
      dates, pools: pools.length, compress: compressLog.reduce((a, r) => a + r.groups, 0),
      diagnose: diagnoseLog.reduce((a, r) => a + r.diagnosed, 0),
    })
    return { compressed: compressLog, diagnosed: diagnoseLog }
  })

  // AI 综述 facts 计算（cause-stats 与 cause-summary 共用；与图同源，SQL 毫秒级）
  const computeAiSummaryFacts = (start, end, statusFilter) => {
    const db = getDb()
    const allGroups = db.prepare(`
      SELECT COUNT(*) AS total, SUM(pre_compress_count) AS pre,
             SUM(CASE WHEN product_action_status = '待处理' THEN 1 ELSE 0 END) AS pending,
             SUM(CASE WHEN product_action_status = '已处理' THEN 1 ELSE 0 END) AS processed,
             SUM(CASE WHEN customer_type IN ('仿真', '测试账号') THEN 1 ELSE 0 END) AS sim
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? ${statusFilter}
    `).get(start, end)
    const undiagRow = db.prepare(`
      SELECT COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NULL ${statusFilter}
    `).get(start, end)
    const topCauseRow = db.prepare(`
      SELECT root_cause_l1 AS l1, COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL ${statusFilter}
      GROUP BY root_cause_l1 ORDER BY n DESC LIMIT 1
    `).get(start, end)
    const topApiRow = db.prepare(`
      SELECT api_path, pool_name, COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL ${statusFilter}
      GROUP BY api_path, pool_name ORDER BY n DESC LIMIT 1
    `).get(start, end)
    return {
      rangeDesc: `${start} ~ ${end}`,
      totalGroups: Number(/** @type {{total?: number}} */ (allGroups)?.total || 0),
      pendingGroups: Number(/** @type {{pending?: number}} */ (allGroups)?.pending || 0),
      processedGroups: Number(/** @type {{processed?: number}} */ (allGroups)?.processed || 0),
      simGroups: Number(/** @type {{sim?: number}} */ (allGroups)?.sim || 0),
      preCompressTotal: Number(/** @type {{pre?: number}} */ (allGroups)?.pre || 0),
      undiagnosedGroups: Number(/** @type {{n?: number}} */ (undiagRow)?.n || 0),
      topCause: String(/** @type {{l1?: string}} */ (topCauseRow)?.l1 || ''),
      topApi: topApiRow ? `${String(topApiRow.pool_name)} ${String(topApiRow.api_path)}` : '',
    }
  }

  // ⑤总览聚合 cause-stats（docs §7.2）：单一接口支撑总览五模块
  app.get('/api/patrol/cause-stats', { preHandler: requirePermission('view') }, async (request, reply) => {
    const q = /** @type {{startDate?: string, endDate?: string, pendingOnly?: string, includeBackfill?: string}} */ (request.query)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(q.startDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(q.endDate || ''))) {
      return reply.code(400).send({ error: '缺少 startDate/endDate（YYYY-MM-DD）' })
    }
    const start = String(q.startDate)
    const end = String(q.endDate)
    const pendingOnly = q.pendingOnly === '1' || q.pendingOnly === 'true'
    const includeBackfill = q.includeBackfill === '1' || q.includeBackfill === 'true'
    const db = getDb()

    const statusFilter = pendingOnly ? `AND product_action_status = '待处理'` : ''

    // ②根因分布（严重度双维度：组数 + 压缩前次数）
    const byProductCause = db.prepare(`
      SELECT product_key AS productKey, root_cause_l1 AS l1,
             COUNT(*) AS groupCount, SUM(pre_compress_count) AS preCompressTotal
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL ${statusFilter}
      GROUP BY product_key, root_cause_l1
      ORDER BY groupCount DESC
    `).all(start, end)

    // ④L1 趋势（七类全画，缺类 0）
    const L1_KEYS = ['业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败', '资源状态异常', '诊断能力缺口', '其他/未归类']
    /** @type {Array<Record<string, unknown>>} */
    const dailyTrend = []
    const trendRows = db.prepare(`
      SELECT group_date AS date, root_cause_l1 AS l1, COUNT(*) AS n
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL ${statusFilter}
      GROUP BY group_date, root_cause_l1
    `).all(start, end)
    const days = eachDay(start, end)
    for (const day of days) {
      /** @type {Record<string, unknown>} */
      const row = { date: day }
      for (const k of L1_KEYS) row[k] = 0
      dailyTrend.push(row)
    }
    const trendMap = new Map(dailyTrend.map((r) => [String(r.date), r]))
    for (const r of trendRows) {
      const row = trendMap.get(String(r.date))
      if (row) row[String(r.l1)] = Number(r.n)
    }

    // ⑤跨日轨迹 L2 Top8（热力日历/折线双形态数据同源）
    const l2Rows = db.prepare(`
      SELECT root_cause_l2 AS l2, group_date AS date, COUNT(*) AS n
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l2 IS NOT NULL ${statusFilter}
      GROUP BY root_cause_l2, group_date
    `).all(start, end)
    const l2Totals = new Map()
    for (const r of l2Rows) {
      l2Totals.set(String(r.l2), (l2Totals.get(String(r.l2)) || 0) + Number(r.n))
    }
    const topL2 = [...l2Totals.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([l2]) => l2)
    const l2Calendar = topL2.map((l2) => ({
      l2,
      days: l2Rows
        .filter((r) => String(r.l2) === l2)
        .map((r) => ({ date: String(r.date), count: Number(r.n) })),
    }))

    // ③指标趋势（缺天断线；backfill 开启用明细 Σ 补算+标记）
    const statsRows = db.prepare(`
      SELECT stat_date, pool_name, metric_name, api_path, success_rate
      FROM api_patrol_stats WHERE stat_date BETWEEN ? AND ?
    `).all(start, end)
    const trendKeys = new Map()
    for (const s of statsRows) {
      const key = `${s.pool_name}\u0000${s.api_path}\u0000${s.metric_name}`
      if (!trendKeys.has(key)) trendKeys.set(key, { pool: s.pool_name, apiPath: s.api_path, metricName: s.metric_name, points: new Map() })
      trendKeys.get(key).points.set(String(s.stat_date), { successRate: Number(s.success_rate), backfilled: false })
    }
    if (includeBackfill) {
      const backfillRows = db.prepare(`
        SELECT request_date, pool_name, api_path, is_success, COUNT(*) n
        FROM api_patrol_requests
        WHERE request_date BETWEEN ? AND ?
        GROUP BY request_date, pool_name, api_path, is_success
      `).all(start, end)
      const agg = new Map()
      for (const r of backfillRows) {
        const key = `${r.pool_name}\u0000${r.api_path}`
        const dkey = `${key}\u0000${r.request_date}`
        if (!agg.has(dkey)) agg.set(dkey, { key, date: String(r.request_date), total: 0, fail: 0 })
        const a = agg.get(dkey)
        a.total += Number(r.n)
        if (Number(r.is_success) === 0) a.fail += Number(r.n)
      }
      for (const a of agg.values()) {
        const statKey = `${a.key}\u0000${a.metricName || ''}`
        // stats 已有该日数据 → 不补（推送口径优先）
        const hasStats = [...trendKeys.entries()].some(([k, v]) =>
          k.startsWith(`${a.key}\u0000`) && v.points.has(a.date))
        if (hasStats) continue
        // 找到对应 trend 槽（池+接口匹配，metricName 可能为空串槽）
        let slot = null
        for (const [k, v] of trendKeys.entries()) {
          if (k.startsWith(`${a.key}\u0000`) && !v.points.has(a.date)) { slot = v; break }
        }
        if (!slot) continue
        slot.points.set(a.date, {
          successRate: a.total > 0 ? Math.round(((a.total - a.fail) / a.total) * 10000) / 100 : null,
          backfilled: true,
        })
      }
    }
    const metricTrends = [...trendKeys.values()].map((t) => ({
      pool: t.pool, apiPath: t.apiPath, metricName: t.metricName,
      // 全序列（缺天=null 条目 → 前端 recharts connectNulls=false 断线依据）
      points: eachDay(start, end).map((date) => {
        const p = t.points.get(date)
        return { date, successRate: p ? p.successRate : null, backfilled: p ? p.backfilled : false }
      }),
    }))

    // ①AI 综述 facts（与图同源；LLM 只润色文字，数字全部走 facts 锚点——防改数）
    // 2026-11-07 拆分：facts 秒回随图表；LLM 润色移独立端点 cause-summary——慢不阻塞图表
    const aiSummaryFacts = computeAiSummaryFacts(start, end, statusFilter)

    return { byProductCause, dailyTrend, l2Calendar, metricTrends, aiSummaryFacts }
  })

  // ⑤'AI 综述独立端点（2026-11-07 拆分）：LLM 润色慢也不拖图表——前端两段加载（图表先行、综述慢填）
  app.get('/api/patrol/cause-summary', { preHandler: requirePermission('view') }, async (request, reply) => {
    const q = /** @type {{startDate?: string, endDate?: string, pendingOnly?: string}} */ (request.query)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(q.startDate || '')) || !/^\d{4}-\d{2}-\d{2}$/.test(String(q.endDate || ''))) {
      return reply.code(400).send({ error: '缺少 startDate/endDate（YYYY-MM-DD）' })
    }
    const start = String(q.startDate)
    const end = String(q.endDate)
    const pendingOnly = q.pendingOnly === '1' || q.pendingOnly === 'true'
    const statusFilter = pendingOnly ? `AND product_action_status = '待处理'` : ''
    const facts = computeAiSummaryFacts(start, end, statusFilter)
    const summary = await buildAiSummary(facts, pendingOnly)
    return { facts, summary }
  })
}

/** LLM 综述润色：facts → 提示词 → LLM；未配置/失败 → 模板直出（degraded=true）。 */
async function buildAiSummary(facts, pendingOnly) {
  const templateText = `${facts.rangeDesc} 共 ${facts.totalGroups} 个失败组` +
    `（压缩前 ${facts.preCompressTotal} 次请求失败）` +
    `${facts.simGroups > 0 ? `，其中 ${facts.simGroups} 组为仿真/测试流量` : ''}。` +
    `最主要的根因大类是「${facts.topCause || '—'}」，` +
    `异常最集中的接口是 ${facts.topApi || '—'}。` +
    `当前待产品侧处理的失败组 ${facts.pendingGroups} 个，本期已处理 ${facts.processedGroups || 0} 组。`
  let apiKey
  try {
    apiKey = resolveLlmApiKey()
  } catch {
    return { degraded: true, text: templateText }
  }
  try {
    const body = {
      model: resolveLlmModel(),
      messages: [
        { role: 'system', content: '你是 API 质量运营助手。基于给定事实写 2-3 句中文综述，不要出现任何具体数字（数字由系统单独渲染），不要编造事实。' },
        { role: 'user', content: JSON.stringify(facts) },
      ],
      temperature: 0.3,
    }
    const res = await forwardLlmChatCompletion({
      baseUrl: resolveLlmBaseUrl(), apiKey, body, timeoutMs: 10_000,
    })
    const text = getLlmCompletionText(res?.data || res)
    if (!text) return { degraded: true, text: templateText }
    return { degraded: false, text }
  } catch {
    return { degraded: true, text: templateText }
  }
}

/** 溯源页巡检概况模板文案（降级直出即完整可用；数字全部来自 facts——LLM 模式下数字由前端锚点渲染）。 */
function buildPatrolSummaryTemplate(facts) {
  const w = facts.window
  const rangeDesc = w.days === 1 ? w.start : `${w.start} ~ ${w.end}（${w.days} 天）`
  const parts = [`API 巡检概况（${rangeDesc}）：检测覆盖 ${facts.productCount} 个产品、${facts.poolCount} 个资源池，发现 ${facts.interfaceCount} 个异常接口（其中 ${facts.belowThresholdCount} 个低于 99.5% 推送阈值），失败请求 ${facts.failTotal} 次。`]
  const worst = facts.worstTop3 && facts.worstTop3[0]
  if (worst) {
    parts.push(`成功率最差：${worst.productName}·${worst.apiPath}（${worst.pool}，成功率 ${worst.successRate}%、失败 ${worst.failCount} 次${worst.pureSim ? '，全部为仿真/测试流量' : ''}）。`)
  }
  if (facts.focus) {
    parts.push(`失败最集中：${facts.focus.productName}·${facts.focus.apiPath}·${facts.focus.causeL2}（压缩前 ${facts.focus.pre} 次 / ${facts.focus.groups} 组${facts.focus.simPre > 0 ? `，其中仿真/测试 ${facts.focus.simPre} 次` : ''}）。`)
  }
  if (facts.causeTop3 && facts.causeTop3.length) {
    parts.push(`主要根因：${facts.causeTop3.map((c) => `${c.l1} ${c.ratio}%`).join(' · ')}。`)
  }
  const c = facts.closure
  parts.push(`闭环状态：待产品侧处理 ${c.pending} 组、已处理 ${c.processed} 组、处理中 ${c.inProgress} 组${c.notNeeded ? `、无需产品处理 ${c.notNeeded} 组` : ''}${c.undiagnosed ? `、未诊断 ${c.undiagnosed} 组` : ''}${c.simGroups ? `（仿真/测试流量 ${c.simGroups} 组已打标）` : ''}。`)
  if (facts.delta) {
    const d = facts.delta
    parts.push(`较上一等长周期：失败请求 ${d.failDelta >= 0 ? '+' : ''}${d.failDelta} 次、异常接口 ${d.interfaceDelta >= 0 ? '+' : ''}${d.interfaceDelta} 个。`)
  }
  return parts.join('\n')
}

/** 巡检概况 LLM 润色（M7 buildAiSummary 同款模式：LLM 输出不含数字，数字由前端 facts 锚点渲染）。 */
async function buildPatrolSummaryText(facts) {
  const templateText = buildPatrolSummaryTemplate(facts)
  let apiKey
  try {
    apiKey = resolveLlmApiKey()
  } catch {
    return { degraded: true, text: templateText }
  }
  try {
    const body = {
      model: resolveLlmModel(),
      messages: [
        { role: 'system', content: '你是 API 质量运营助手。基于给定的巡检事实写 3-5 句中文概况，聚焦检测结果与异常情况（最差接口、失败集中点、主要根因、闭环状态）。用换行分隔、每行一个焦点短句（不要用编号或项目符号）。不要出现任何具体数字（数字由系统单独渲染），不要编造事实。' },
        { role: 'user', content: JSON.stringify(facts) },
      ],
      temperature: 0.3,
    }
    const res = await forwardLlmChatCompletion({
      baseUrl: resolveLlmBaseUrl(), apiKey, body, timeoutMs: 10_000,
    })
    const text = getLlmCompletionText(res?.data || res)
    if (!text) return { degraded: true, text: templateText }
    return { degraded: false, text }
  } catch {
    return { degraded: true, text: templateText }
  }
}

/** 日期序列（含端点；本地日期格式化——toISOString 走 UTC 会偏移一天）。 */
function eachDay(start, end) {
  /** @type {string[]} */
  const out = []
  const s = new Date(`${start}T00:00:00`)
  const e = new Date(`${end}T00:00:00`)
  for (let d = new Date(s); d <= e; d.setDate(d.getDate() + 1)) {
    const y = d.getFullYear()
    const m = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    out.push(`${y}-${m}-${day}`)
  }
  return out
}

/** 行 → camelCase（snake_case 列名转驼峰；API 返回统一 camel，前端零映射）。 */
function rowToCamel(row) {
  if (!row || typeof row !== 'object') return row
  /** @type {Record<string, unknown>} */
  const out = {}
  for (const [k, v] of Object.entries(row)) {
    out[k.replace(/_([a-z0-9])/g, (_, c) => c.toUpperCase())] = v
  }
  return out
}

/** @param {string} json */
function safeParseIds(json) {
  try {
    const parsed = JSON.parse(json || '[]')
    return Array.isArray(parsed) ? parsed.map(String) : []
  } catch {
    return []
  }
}
