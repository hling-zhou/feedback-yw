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

  // ①异常接口列表
  app.get('/api/patrol/failures/interfaces', { preHandler: requirePermission('view') }, async (request, reply) => {
    const range = parseRange(request.query)
    if (!range) return reply.code(400).send({ error: '缺少 date 或 startDate/endDate（YYYY-MM-DD）' })
    const db = getDb()
    const statsRows = db.prepare(`
      SELECT stat_date, pool_name, metric_name, api_path, biz_type, success_rate,
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
          pool: s.pool_name, metricName: s.metric_name, apiPath: s.api_path, bizType: s.biz_type,
          successRate: null, // 跨日由明细 Σ 重算（下行覆盖）
          totalCount: agg.total, failCount: agg.fail,
          avgDuration: null, durationNormalRatio: null, // 跨日显示"—"（C 拍板）
          statDates: [s.stat_date],
        })
        continue
      }
      out.push({
        pool: s.pool_name, metricName: s.metric_name, apiPath: s.api_path, bizType: s.biz_type,
        successRate: agg.total > 0
          ? Math.round(((agg.total - agg.fail) / agg.total) * 10000) / 100
          : Number(s.success_rate),
        totalCount: agg.total, failCount: agg.fail,
        avgDuration: s.avg_duration, durationNormalRatio: s.duration_normal_ratio,
        statDates: [s.stat_date],
      })
    }
    // 跨日 Σ：合并同键后重算成功率
    for (const o of out) {
      if (o.statDates.length > 0 && !range.single && o.totalCount > 0) {
        o.successRate = Math.round(((o.totalCount - o.failCount) / o.totalCount) * 10000) / 100
      }
    }
    // 排序：<99.5% 优先在前，其余按序（拍板：展示全部<100%）
    out.sort((a, b) => {
      const ra = a.successRate == null ? 100 : Number(a.successRate)
      const rb = b.successRate == null ? 100 : Number(b.successRate)
      const aLow = ra < 99.5 ? 0 : 1
      const bLow = rb < 99.5 ? 0 : 1
      if (aLow !== bLow) return aLow - bLow
      return ra - rb
    })
    return { rows: out }
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
    const allGroups = db.prepare(`
      SELECT COUNT(*) AS total, SUM(pre_compress_count) AS pre,
             SUM(CASE WHEN product_action_status = '待处理' THEN 1 ELSE 0 END) AS pending,
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
    const aiSummaryFacts = {
      rangeDesc: `${start} ~ ${end}`,
      totalGroups: Number(/** @type {{total?: number}} */ (allGroups)?.total || 0),
      pendingGroups: Number(/** @type {{pending?: number}} */ (allGroups)?.pending || 0),
      simGroups: Number(/** @type {{sim?: number}} */ (allGroups)?.sim || 0),
      preCompressTotal: Number(/** @type {{pre?: number}} */ (allGroups)?.pre || 0),
      undiagnosedGroups: Number(/** @type {{n?: number}} */ (undiagRow)?.n || 0),
      topCause: String(/** @type {{l1?: string}} */ (topCauseRow)?.l1 || ''),
      topApi: topApiRow ? `${String(topApiRow.pool_name)} ${String(topApiRow.api_path)}` : '',
    }

    // LLM 综述润色（可用则调，失败/未配置 → 模板降级；数字锚点在前端渲染，LLM 不落数字）
    const aiSummary = await buildAiSummary(aiSummaryFacts, pendingOnly)

    return { byProductCause, dailyTrend, l2Calendar, metricTrends, aiSummaryFacts, aiSummary }
  })
}

/** LLM 综述润色：facts → 提示词 → LLM；未配置/失败 → 模板直出（degraded=true）。 */
async function buildAiSummary(facts, pendingOnly) {
  const templateText = `${facts.rangeDesc} 共 ${facts.totalGroups} 个失败组` +
    `（压缩前 ${facts.preCompressTotal} 次请求失败）` +
    `${facts.simGroups > 0 ? `，其中 ${facts.simGroups} 组为仿真/测试流量` : ''}。` +
    `最主要的根因大类是「${facts.topCause || '—'}」，` +
    `异常最集中的接口是 ${facts.topApi || '—'}。` +
    `当前待产品侧处理的失败组 ${facts.pendingGroups} 个。`
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
      baseUrl: resolveLlmBaseUrl(), apiKey, body, timeoutMs: 30_000,
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
