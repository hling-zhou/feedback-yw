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
import { fetchPatrolMcpPoolEnum, getPatrolMcpPoolEnum, poolInMcpEnum as poolInMcpEnumFn } from '../patrolMcpPoolRegistry.js'
import { isExemptFromProductAction, listPatrolActionExemptions, putPatrolActionExemptions, clearPatrolActionExemptionsCache } from '../patrolActionExemptions.js'
import { productNameMap } from '../patrolReportBuilder.js'
import { cleanLogLine } from '../patrolRootCauseClassifier.js'
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
  //   11-17 加 product 过滤（分产品筛选——两 tab 共用键）。
  const computeFailureInterfaces = (range, product) => {
    const db = getDb()
    const PRODUCT_NAMES = productNameMap()
    const statsRows = db.prepare(`
      SELECT stat_date, product_key, pool_name, metric_name, api_path, biz_type, success_rate,
             duration_normal_ratio, avg_duration
      FROM api_patrol_stats
      WHERE stat_date BETWEEN ? AND ?${product ? ' AND product_key = ?' : ''}
      ORDER BY success_rate ASC
    `).all(...(product ? [range.start, range.end, product] : [range.start, range.end]))

    // 明细 Σ 重算（按 池×接口 聚合；11-17 分产品筛选——api_path 与产品强关联，
    // 但同池同名接口跨产品时按 stats 行的产品键归并更严谨：此处给聚合键追加产品维度）
    const detailAgg = new Map()
    const rows = db.prepare(`
      SELECT request_date, pool_name, api_path, is_success, COUNT(*) n
      FROM api_patrol_requests
      WHERE request_date BETWEEN ? AND ?
      GROUP BY request_date, pool_name, api_path, is_success
    `).all(range.start, range.end)
    // requests 无产品列——api_path 前缀判产品不可靠（ELB 形态无 /）。按池×接口聚合保持原样，
    // 产品过滤由 statsRows 单侧收敛（out 只从 statsRows 生成——聚合值只被 stats 行消费）。
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
    const product = String(request.query.product || '').trim() || undefined
    return { rows: computeFailureInterfaces(range, product) }
  })

  // ①''分产品计数（11-17：两 tab 产品筛选选项数据源——
  //    异常接口列表按接口行数计、失败请求列表按组数计，同一端点双口径一次拉取）
  app.get('/api/patrol/failures/product-counts', { preHandler: requirePermission('view') }, async (request, reply) => {
    const range = parseRange(request.query)
    if (!range) return reply.code(400).send({ error: '缺少 date 或 startDate/endDate（YYYY-MM-DD）' })
    const db = getDb()
    const PRODUCT_NAMES = productNameMap()
    // 接口行口径：窗口内 stats 行数（单日=行数；跨日=池×接口合并行近似——直接按 stats 行计，两口径一致性够筛选用）
    const ifaceRows = db.prepare(`
      SELECT product_key, COUNT(*) n FROM api_patrol_stats
      WHERE stat_date BETWEEN ? AND ? GROUP BY product_key
    `).all(range.start, range.end)
    /** @type {Record<string, number>} */
    const ifaceMap = {}
    for (const r of ifaceRows) ifaceMap[String(r.product_key)] = Number(r.n)
    // 组数口径
    const groupRows = db.prepare(`
      SELECT product_key, COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? GROUP BY product_key
    `).all(range.start, range.end)
    /** @type {Record<string, number>} */
    const groupMap = {}
    for (const r of groupRows) groupMap[String(r.product_key)] = Number(r.n)
    // 产品目录真源（先 loadManagedProductCatalog 刷新防缓存陈旧——10-25 根因先例；
    //    复用 loadPatrolCatalogShared：含 metaAdapter + 刷新 + products 读取全链）
    const { loadPatrolCatalogShared } = await import('../patrolIngestion.js')
    const catalog = await loadPatrolCatalogShared()
    /** @type {Record<string, string>} */
    const catalogNames = {}
    for (const p of catalog) catalogNames[p.key] = p.name
    // 输出：窗口内有数据的产品（计数并集）；目录外产品键（数据异常）也如实出现——名字用 PRODUCT_NAMES 兜底
    const keySet = new Set([...Object.keys(ifaceMap), ...Object.keys(groupMap)])
    const rows = [...keySet].sort().map((key) => ({
      key, name: catalogNames[key] || PRODUCT_NAMES[key] || key,
      interfaceCount: ifaceMap[key] || 0,
      groupCount: groupMap[key] || 0,
    }))
    return { rows }
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
      SELECT product_key pk, api_path, COALESCE(NULLIF(root_cause_l2_manual, ''), root_cause_l2) l2, SUM(pre_compress_count) pre, COUNT(*) groups,
             SUM(CASE WHEN customer_type IN ('仿真','测试账号') THEN pre_compress_count ELSE 0 END) simPre
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL
      GROUP BY product_key, api_path, COALESCE(NULLIF(root_cause_l2_manual, ''), root_cause_l2)
      ORDER BY pre DESC LIMIT 1
    `).all(range.start, range.end)
    const focus = focusRows.length ? {
      productName: PRODUCT_NAMES[focusRows[0].pk] || focusRows[0].pk,
      apiPath: String(focusRows[0].api_path || ''), causeL2: String(focusRows[0].l2 || ''),
      pre: Number(focusRows[0].pre || 0), groups: Number(focusRows[0].groups || 0),
      simPre: Number(focusRows[0].simPre || 0),
    } : null

    // 根因 Top3（窗口内已诊断组 L1 占比）+ 闭环状态 + 仿真/未诊断——11-18 manual 优先（同口径 COALESCE）
    const l1Rows = db.prepare(`
      SELECT COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1) l1, COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL
      GROUP BY COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1) ORDER BY n DESC LIMIT 3
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
    // 复合搜索全字段参数（11-18 拍板）：未指定字段时的默认全字段搜——
    // RequestID/指标/接口/客户名四列 OR LIKE（含被压缩 IDs 内的 RequestID）
    if (q.q) {
      const like = `%${q.q}%`
      where.push(`(g.first_request_id LIKE ? OR g.suppressed_request_ids LIKE ?
                   OR g.metric_name LIKE ? OR g.api_path LIKE ? OR g.user_name LIKE ?)`)
      params.push(like, like, like, like, like)
    }
    // 11-19 升级：L1/L2 过滤改有效根因口径（manual 优先 COALESCE）——与列表 Tag 展示
    // （displayRootCause manual 优先）、cause-stats 聚合口径同源自洽；修复总览跳转计数漂移。
    if (q.rootCauseL1) {
      where.push(`COALESCE(NULLIF(g.root_cause_l1_manual, ''), g.root_cause_l1) = ?`)
      params.push(q.rootCauseL1)
    }
    if (q.rootCauseL2) {
      where.push(`COALESCE(NULLIF(g.root_cause_l2_manual, ''), g.root_cause_l2) = ?`)
      params.push(q.rootCauseL2)
    }
    // 11-19 诊断能力需求页下钻参数（通用）：poolName 等值；apiPathExact 精确匹配
    // （防 LIKE 子串误伤——/bind 与 /unbind 路径前缀重叠场景）
    if (q.poolName) { where.push('g.pool_name = ?'); params.push(q.poolName) }
    if (q.apiPathExact) { where.push('g.api_path = ?'); params.push(q.apiPathExact) }
    // 11-18 拍板：「其他」= 仿真/测试账号以外的真实客户（customer_type 空值或非标注值）
    if (q.customerType === '__others__') {
      where.push(`(g.customer_type IS NULL OR g.customer_type = '' OR (g.customer_type <> '仿真' AND g.customer_type <> '测试账号'))`)
    } else if (q.customerType) { where.push('g.customer_type = ?'); params.push(q.customerType) }
    if (q.assignee) { where.push('g.assignee = ?'); params.push(q.assignee) }
    if (q.status) {
      if (q.status === '需产品侧处理') {
        where.push("g.product_action_status IN ('待处理', '处理中', '已处理')")
      } else if (q.status === '未诊断') { where.push(`g.product_action_status = 'pending_diagnosis'`) }
      else { where.push('g.product_action_status = ?'); params.push(q.status) }
    }
    if (q.minPreCount) { where.push('g.pre_compress_count >= ?'); params.push(Number(q.minPreCount)) }
    const rows = db.prepare(`
      SELECT id, group_date AS groupDate, product_key AS productKey, pool_name AS poolName,
             api_path AS apiPath, metric_name AS metricName, user_name AS userName,
             first_request_id AS firstRequestId, first_request_time AS firstRequestTime,
             pre_compress_count AS preCompressCount, suppressed_request_ids AS suppressedRequestIds,
             customer_type AS customerType, root_cause_l1 AS rootCauseL1, root_cause_l2 AS rootCauseL2,
             root_cause_l1_manual AS rootCauseL1Manual, root_cause_l2_manual AS rootCauseL2Manual,
             product_action_status AS productActionStatus, assignee,
             root_cause_confirmed AS rootCauseConfirmed, measure_feedback AS measureFeedback,
             feedback_by AS feedbackBy, feedback_at AS feedbackAt
      FROM api_patrol_failure_groups g
      WHERE ${where.join(' AND ')}
      ORDER BY g.group_date DESC, g.first_request_time DESC
      LIMIT 500
    `).all(...params)
    // 产品名（11-17 失败请求列表加「产品」列）：与异常接口列表同源——productNameMap() 单一映射函数
    const PRODUCT_NAMES = productNameMap()
    for (const r of rows) {
      /** @type {{ productKey?: string }} */ (r).productName = PRODUCT_NAMES[String(/** @type {{ productKey?: string }} */ (r).productKey || '')] || /** @type {{ productKey?: string }} */ (r).productKey
    }
    return { rows }
  })

  // ②' 经办人选项列表（11-17：失败请求列表经办人筛选——单选模糊匹配的下拉数据源；
  //    口径 = 当前时间范围 DISTINCT 非空 assignee，按组数降序）
  app.get('/api/patrol/failures/assignees', { preHandler: requirePermission('view') }, async (request, reply) => {
    const range = parseRange(request.query)
    if (!range) return reply.code(400).send({ error: '缺少 startDate/endDate' })
    const db = getDb()
    const rows = db.prepare(`
      SELECT assignee, COUNT(*) AS n
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND assignee IS NOT NULL AND assignee != ''
      GROUP BY assignee
      ORDER BY n DESC, assignee
      LIMIT 200
    `).all(range.start, range.end)
    return { rows: rows.map((r) => ({ assignee: String(r.assignee), count: Number(r.n) })) }
  })

  // ③详情
  app.get('/api/patrol/failures/groups/:id', { preHandler: requirePermission('view') }, async (request, reply) => {
    const id = Number((/** @type {{id: string}} */ (request.params)).id)
    if (!Number.isInteger(id)) return reply.code(400).send({ error: 'id 非法' })
    const db = getDb()
    const group = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE id=?`).get(id)
    if (!group) return reply.code(404).send({ error: '组不存在' })
    const diag = db.prepare(`
      SELECT request_id, status, tool_name, mcp_raw_response, final_conclusion, suggestion,
             root_cause_l1, root_cause_l2, direct_cause, evidence, root_cause_source, action_reason, diagnosed_at
      FROM api_patrol_diagnoses WHERE failure_group_id=? ORDER BY id DESC LIMIT 1
    `).get(id)
    // 诊断结果五段（11-17 拍板：结论/失败组信息/直接原因/关键证据/处理建议——服务端切分单源）
    const diagnosisReport = diag ? buildDiagnosisReport(group, diag) : null
    // 被压缩请求明细：从 suppressed_request_ids 展开
    /** @type {Array<Record<string, unknown>>} */
    const detailRows = []
    const g = /** @type {{first_request_id: string, suppressed_request_ids: string, pool_name: string, request_id?: string}} */ (group)
    const ids = [g.first_request_id, ...safeParseIds(g.suppressed_request_ids)]
    // 11-24 键 V2：同 reqId 批量子任务行全部返回（单行 get 会吞子行）；按组日期过滤防跨日混入
    const reqQuery = db.prepare(`
      SELECT request_id, request_time, end_time, is_success, duration_ms, error_message
      FROM api_patrol_requests
      WHERE request_id = ? AND request_date = ?
      ORDER BY external_row_id
    `)
    for (const rid of ids) {
      const rs = reqQuery.all(rid, group.group_date)
      for (const r of rs) detailRows.push(r)
    }
    return {
      group: rowToCamel(group),
      diagnosis: diag ? rowToCamel(diag) : null,
      diagnosisReport,
      requests: detailRows.map((r) => rowToCamel(r)),
    }
  })

  // ④处理闭环 PATCH（11-20 拍板：manageTags → editRecord，与前端抽屉 canEdit 同口径）
  app.patch('/api/patrol/failures/groups/:id', { preHandler: requirePermission('editRecord') }, async (request, reply) => {
    const id = Number((/** @type {{id: string}} */ (request.params)).id)
    const body = /** @type {{action?: string, rootCauseConfirmed?: string, realRootCause?: string,
      measureFeedback?: string, assignee?: string,
      actionId?: string, establishedAction?: string, actionSchedule?: string,
      rootCauseL1Manual?: string, rootCauseL2Manual?: string}} */ (request.body || {})
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
      return reply.code(400).send({ error: '提交时必须填写备注（不涉及也需说明）' })
    }
    const status = body.action === 'submit' ? '已处理' : '处理中'
    const now = new Date().toISOString()
    // 11-18 确立举措三列（与投诉咨询线同语义：不强制必填；actionId 关联举措库，手填内容与排期可独立）
    // 11-18 人工修正根因三列（独立存储不覆盖 LLM 原判——两值并存供对比/算准确率）；
    // real_root_cause 同时补历史丢数据洞（旧版前端收了但 UPDATE 没存）
    db.prepare(`
      UPDATE api_patrol_failure_groups SET
        product_action_status=?, root_cause_confirmed=COALESCE(?, root_cause_confirmed),
        measure_feedback=COALESCE(?, measure_feedback), assignee=COALESCE(?, assignee),
        action_id=COALESCE(?, action_id), established_action=COALESCE(?, established_action),
        action_schedule=COALESCE(?, action_schedule),
        root_cause_l1_manual=COALESCE(?, root_cause_l1_manual),
        root_cause_l2_manual=COALESCE(?, root_cause_l2_manual),
        real_root_cause=COALESCE(?, real_root_cause),
        feedback_by=?, feedback_at=?, updated_at=?
      WHERE id=?
    `).run(
      status,
      body.rootCauseConfirmed ?? null,
      body.measureFeedback ?? null,
      body.assignee ?? null,
      body.actionId ?? null,
      body.establishedAction ?? null,
      body.actionSchedule ?? null,
      body.rootCauseL1Manual ?? null,
      body.rootCauseL2Manual ?? null,
      body.realRootCause ?? null,
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
        actionId: /** @type {{action_id: string | null}} */ (before).action_id,
        rootCauseL1Manual: /** @type {{root_cause_l1_manual: string | null}} */ (before).root_cause_l1_manual,
      },
      after: {
        productActionStatus: /** @type {{product_action_status: string}} */ (after).product_action_status,
        assignee: /** @type {{assignee: string | null}} */ (after).assignee,
        rootCauseConfirmed: /** @type {{root_cause_confirmed: string | null}} */ (after).root_cause_confirmed,
        measureFeedback: /** @type {{measure_feedback: string | null}} */ (after).measure_feedback,
        actionId: /** @type {{action_id: string | null}} */ (after).action_id,
        rootCauseL1Manual: /** @type {{root_cause_l1_manual: string | null}} */ (after).root_cause_l1_manual,
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
      SELECT COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1) AS l1, COUNT(*) n FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL ${statusFilter}
      GROUP BY COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1) ORDER BY n DESC LIMIT 1
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
  // ⑦诊断能力需求池（11-19 拍板）：「诊断能力缺口」类失败组汇集——云网工作台 MCP 日志服务
  // 诊断能力建设的需求输入。第一版只读；池接入分类从诊断产物自动推断（classifyGapKind，
  // 不维护池清单——覆盖范围会变，静态清单必过时）。
  // 口径：COALESCE 有效根因判定（人工修正为具体根因后自动退出需求池）。
  // 11-20 09:44 拍板：需求池显示全部——无时间窗口（parseRange/BETWEEN 已删）。
  app.get('/api/patrol/diagnosis-gaps/summary', { preHandler: requirePermission('view') }, async (_request, reply) => {
    const db = getDb()
    const GAP_WHERE = `g.root_cause_l1 IS NOT NULL
      AND COALESCE(NULLIF(g.root_cause_l1_manual, ''), g.root_cause_l1) = '诊断能力缺口'`
    // 组级明细（含最新成功诊断的 MCP 原始响应——gapKind 判定素材）。
    // 11-20 误判修复：d 只取 status='success' 的最新记录（诊断失败路径写 {"error":...}
    // failed 记录且组可重试——曾因 MAX(id) 不分成败，把「重试失败」误读成「池未接入」，
    // 先例：华南-广州3/华北-北京3 实际已接入）；e 提供维度区分「从未诊断」vs「只有失败记录待重试」。
    const groupRows = db.prepare(`
      SELECT g.id, g.product_key, g.api_path, g.pool_name, g.pre_compress_count,
             g.group_date, g.first_request_id, g.suppressed_request_ids, g.first_request_time,
             g.user_name,
             d.failure_group_id AS diagId, d.mcp_raw_response AS mcpRaw,
             e.failure_group_id AS anyDiagId
      FROM api_patrol_failure_groups g
      LEFT JOIN (
        SELECT failure_group_id, mcp_raw_response FROM api_patrol_diagnoses
        WHERE id IN (SELECT MAX(id) FROM api_patrol_diagnoses WHERE status='success' GROUP BY failure_group_id)
      ) d ON d.failure_group_id = g.id
      LEFT JOIN (
        SELECT DISTINCT failure_group_id FROM api_patrol_diagnoses
      ) e ON e.failure_group_id = g.id
      WHERE ${GAP_WHERE}
    `).all()
    // 组级 gapKind 判定（SQL 外做——SQLite 无 JSON 解析函数，JS 判定可单测）。
    // 11-20 14:48 拍板：分区一真源=MCP tools/list 的 poolName 枚举（patrolMcpPoolRegistry）——
    // 读取链 内存→meta(24h)→现拉；stale 时 fire-and-forget 后台刷新（本次响应用旧值不阻塞）。
    const poolEnum = getPatrolMcpPoolEnum()
    if (poolEnum.pools && poolEnum.stale) {
      void fetchPatrolMcpPoolEnum().catch(() => { /* 后台刷新失败静默——下次调用再试 */ })
    }
    const kinds = new Map() // id → gapKind
    for (const r of groupRows) {
      kinds.set(Number(r.id), classifyGapKind(r.mcpRaw, r.diagId != null, r.anyDiagId != null, poolInMcpEnumFn(r.pool_name, poolEnum)))
    }
    // 11-21 10:38 拍板：豁免白名单命中组不进需求池分区（豁免组既不占产品处理、也不该出现在
    // 「诊断能力需求」池——那是给产品看的建设需求，豁免组不是需求）。分区一/二同口径过滤；
    // undiagnosed/mcp_error 清单保留豁免组（补诊断是事实动作，与豁免正交）。
    const notExempt = (r) => !isExemptFromProductAction(r.user_name, r.api_path, r.pool_name)
    const covered = groupRows.filter((r) => {
      const k = kinds.get(Number(r.id))
      return (k === 'log_not_collected' || k === 'failure_log_missing') && notExempt(r)
    })
    const uncovered = groupRows.filter((r) => kinds.get(Number(r.id)) === 'pool_uncovered' && notExempt(r))
    // 11-20 拍板：诊断调用失败（只有 failed 记录——MCP 超时/重试失败/LLM 全败）不纳入需求池——
    // 组保持 pending_diagnosis 次日自动重试，也不进未诊断清单（那类只收「从未诊断」）
    const retryPending = groupRows.filter((r) => kinds.get(Number(r.id)) === 'diagnosis_failed')
    // 11-20 拍板：从未诊断的组（超龄收敛态）不进需求池——单独聚合供清单交付（用户补诊断）
    const undiagnosed = groupRows.filter((r) => kinds.get(Number(r.id)) === 'undiagnosed')
    // 11-20 14:48 拍板：池在 MCP 枚举内但调用报错（raw 空/非JSON无日志迹象/业务码非0000）——
    // 临时故障重诊断可愈；复制清单交付补跑（与未诊断同款出口），不进分区一
    const mcpErrored = groupRows.filter((r) => kinds.get(Number(r.id)) === 'mcp_error')

    const PRODUCT_NAMES = productNameMap()
    // 分区二：池已接入·诊断能力不足——产品×接口×池聚合
    const aggMap = new Map()
    for (const r of covered) {
      const key = `${r.product_key}|${r.api_path}|${r.pool_name}`
      if (!aggMap.has(key)) {
        aggMap.set(key, {
          aggregateKey: key,
          productKey: r.product_key, productName: PRODUCT_NAMES[r.product_key] || r.product_key,
          apiPath: r.api_path, poolName: r.pool_name,
          gapKinds: { log_not_collected: 0, failure_log_missing: 0 },
          groupCount: 0, preCompressTotal: 0,
          firstDate: String(r.group_date), lastRequestTime: String(r.first_request_time || ''),
          requestIds: [],
        })
      }
      const a = aggMap.get(key)
      const k = kinds.get(Number(r.id))
      a.gapKinds[k] += 1
      a.groupCount += 1
      a.preCompressTotal += Number(r.pre_compress_count || 0)
      if (String(r.group_date) < a.firstDate) a.firstDate = String(r.group_date)
      if (String(r.first_request_time || '') > a.lastRequestTime) a.lastRequestTime = String(r.first_request_time)
      for (const id of [String(r.first_request_id || ''), ...safeParseIds(r.suppressed_request_ids)]) {
        if (id && !a.requestIds.includes(id)) a.requestIds.push(id)
      }
    }
    const rows = [...aggMap.values()].sort((a, b) => b.preCompressTotal - a.preCompressTotal || b.groupCount - a.groupCount)
    // 分区一：池未接入 MCP——池维度汇总（数据驱动；无实例=空数组，前端不渲染）
    const uncMap = new Map()
    for (const r of uncovered) {
      if (!uncMap.has(r.pool_name)) {
        uncMap.set(r.pool_name, {
          poolName: r.pool_name, groupCount: 0, preCompressTotal: 0,
          lastRequestTime: String(r.first_request_time || ''), requestIds: [],
          // 判定依据样例（11-20 拍板加「判定依据」列）：该池首个 uncovered 组的 MCP 响应片段
          sampleMcpRaw: String(r.mcpRaw || '').slice(0, 200),
          sampleRequestId: String(r.first_request_id || ''),
        })
      }
      const u = uncMap.get(r.pool_name)
      u.groupCount += 1
      u.preCompressTotal += Number(r.pre_compress_count || 0)
      if (String(r.first_request_time || '') > u.lastRequestTime) u.lastRequestTime = String(r.first_request_time)
      for (const id of [String(r.first_request_id || ''), ...safeParseIds(r.suppressed_request_ids)]) {
        if (id && !u.requestIds.includes(id)) u.requestIds.push(id)
      }
    }
    const uncoveredPools = [...uncMap.values()].sort((a, b) => b.preCompressTotal - a.preCompressTotal)
    // 未诊断组聚合（池维度汇总——复制清单交付：每行 日期 池 requestID，用户自行补诊断）
    const unMap = new Map()
    for (const r of undiagnosed) {
      if (!unMap.has(r.pool_name)) {
        unMap.set(r.pool_name, {
          poolName: r.pool_name, groupCount: 0, preCompressTotal: 0,
          firstDate: String(r.group_date), lastRequestTime: String(r.first_request_time || ''),
          requestIds: [],
        })
      }
      const u = unMap.get(r.pool_name)
      u.groupCount += 1
      u.preCompressTotal += Number(r.pre_compress_count || 0)
      if (String(r.group_date) < u.firstDate) u.firstDate = String(r.group_date)
      if (String(r.first_request_time || '') > u.lastRequestTime) u.lastRequestTime = String(r.first_request_time)
      for (const id of [String(r.first_request_id || ''), ...safeParseIds(r.suppressed_request_ids)]) {
        if (id && !u.requestIds.includes(id)) u.requestIds.push(id)
      }
    }
    const undiagnosedGroups = [...unMap.values()].sort((a, b) => b.preCompressTotal - a.preCompressTotal)
    // mcp_error 聚合（池维度汇总——复制清单交付补跑：每行 日期 池 requestID + 响应样例）
    const errMap = new Map()
    for (const r of mcpErrored) {
      if (!errMap.has(r.pool_name)) {
        errMap.set(r.pool_name, {
          poolName: r.pool_name, groupCount: 0, preCompressTotal: 0,
          firstDate: String(r.group_date), lastRequestTime: String(r.first_request_time || ''),
          requestIds: [],
          sampleMcpRaw: String(r.mcpRaw || '').slice(0, 200),
          sampleRequestId: String(r.first_request_id || ''),
        })
      }
      const u = errMap.get(r.pool_name)
      u.groupCount += 1
      u.preCompressTotal += Number(r.pre_compress_count || 0)
      if (String(r.group_date) < u.firstDate) u.firstDate = String(r.group_date)
      if (String(r.first_request_time || '') > u.lastRequestTime) u.lastRequestTime = String(r.first_request_time)
      for (const id of [String(r.first_request_id || ''), ...safeParseIds(r.suppressed_request_ids)]) {
        if (id && !u.requestIds.includes(id)) u.requestIds.push(id)
      }
    }
    const mcpErrorGroups = [...errMap.values()].sort((a, b) => b.preCompressTotal - a.preCompressTotal)
    // stats：窗口统计（引导卡统计行数据源）——undiagnosedCount 单列（11-20：不进需求池计数）
    const apiSet = new Set(covered.map((r) => `${r.product_key}|${r.api_path}`))
    const poolSet = new Set(groupRows.map((r) => r.pool_name))
    return {
      stats: {
        groupCount: groupRows.length,
        uncoveredCount: uncovered.length,
        coveredCount: covered.length,
        undiagnosedCount: undiagnosed.length,
        // 诊断调用失败待自动重试组数（11-20 拍板不纳入需求池——前端统计行条件展示）
        retryPendingCount: retryPending.length,
        // MCP 报错待补跑组数（11-20 14:48 拍板——枚举内池临时故障，复制清单交付）
        mcpErrorCount: mcpErrored.length,
        // 顺手修复：前端引导卡引用 stats.preCompressTotal 但后端从未返回（恒显示 '—'）——
        // 口径对齐 groupCount（全部缺口组）的 pre_compress_count 合计
        preCompressTotal: groupRows.reduce((s, r) => s + Number(r.pre_compress_count || 0), 0),
        apiCount: apiSet.size,
        poolCount: poolSet.size,
      },
      uncoveredPools,
      undiagnosedGroups,
      mcpErrorGroups,
      // 判定模式标注素材（11-20 14:48 拍板）：分区一真源=枚举清单——展示获取时间；降级时标注
      poolEnum: {
        fetchedAt: poolEnum.fetchedAt,
        stale: poolEnum.stale,
        degraded: poolEnum.degraded,
        count: poolEnum.pools ? poolEnum.pools.length : 0,
      },
      rows: rows.map((a) => ({ ...a, jiraTicketId: null, jiraStatus: null })),
    }
  })

  // 历史 pending 转待处理清单（11-20 15:09 拍板）：今日诊断成功且转待产品处理、但失败发生在
  // 历史日期的组——不在列表 T-1 窗口内易漏处理，提示条引导跳转。判定锚点=diagnoses
  // （status='success' AND 今日 diagnosed_at）——精确「今日诊断成功」动作，不受手工改状态污染；
  // 次日自动失配退出（零维护，无已读状态）。
  app.get('/api/patrol/failures/trapped-pending', { preHandler: requirePermission('view') }, async (_request, reply) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT g.product_key, g.pool_name, g.api_path, g.metric_name,
             g.pre_compress_count, g.group_date, g.first_request_id, g.first_request_time
      FROM api_patrol_failure_groups g
      JOIN (SELECT DISTINCT failure_group_id FROM api_patrol_diagnoses
            WHERE status='success' AND substr(diagnosed_at, 1, 10) = date('now', 'localtime')) d
        ON d.failure_group_id = g.id
      WHERE g.product_action_status = '待处理' AND g.group_date < date('now', 'localtime')
      ORDER BY g.group_date, g.first_request_time
      LIMIT 100
    `).all()
    const PRODUCT_NAMES = productNameMap()
    reply.send({
      count: rows.length,
      rows: rows.map((r) => ({
        productKey: r.product_key,
        productName: PRODUCT_NAMES[r.product_key] || r.product_key,
        poolName: r.pool_name, apiPath: r.api_path, metricName: r.metric_name,
        preCompressCount: Number(r.pre_compress_count || 0),
        groupDate: String(r.group_date || ''),
        firstRequestId: String(r.first_request_id || ''),
        firstRequestTime: String(r.first_request_time || ''),
      })),
    })
  })

  // LLM 判定候选建议（11-19 拍板：候选回流——只读聚合，不自动写规则表；运营在规则面板人工纳入）
  // 语义：root_cause_source='llm' 的组按 L1×L2 聚合，出现 ≥2 次的场景列候选（孤例不列——
  // 单次判定不稳定不足以固化）；样例组供跳转复核，keywords 从诊断结论提取供「纳入为规则」预填。
  app.get('/api/patrol/root-cause-llm-candidates', { preHandler: requirePermission('manageTags') }, async (_request, reply) => {
    const db = getDb()
    const rows = db.prepare(`
      SELECT g.id, g.root_cause_l1 AS l1, g.root_cause_l2 AS l2, d.final_conclusion AS conclusion
      FROM api_patrol_failure_groups g
      JOIN api_patrol_diagnoses d ON d.failure_group_id = g.id
      WHERE d.root_cause_source = 'llm' AND g.root_cause_l2 IS NOT NULL AND g.root_cause_l2 != ''
      ORDER BY g.id
    `).all()
    // 聚合 L1×L2
    const buckets = new Map()
    for (const r of rows) {
      const key = `${r.l1}\u0000${r.l2}`
      if (!buckets.has(key)) {
        buckets.set(key, { l1: String(r.l1 || ''), l2: String(r.l2 || ''), sampleGroupIds: [], conclusions: [] })
      }
      const b = buckets.get(key)
      b.sampleGroupIds.push(Number(r.id))
      if (r.conclusion && !b.conclusions.includes(String(r.conclusion))) b.conclusions.push(String(r.conclusion))
    }
    const candidates = []
    for (const b of buckets.values()) {
      if (b.sampleGroupIds.length < 2) continue
      // 关键词素材：从结论提取 4-12 字中文短语片段（去标点切分，取最短可判别词组）
      const keywords = [...new Set(
        b.conclusions.join('，').split(/[，。；、,.;:！!？?\s]+/).filter((s) => s.length >= 3 && s.length <= 16),
      )].slice(0, 8)
      candidates.push({
        l1: b.l1, l2: b.l2,
        count: b.sampleGroupIds.length,
        sampleGroupIds: b.sampleGroupIds.slice(0, 5),
        keywords,
      })
    }
    candidates.sort((a, b) => b.count - a.count)
    return reply.send({ candidates })
  })

  // ── 处理豁免白名单（11-21 10:38 拍板：精确组合豁免——配置资产，读 view 写 manageTags）──
  app.get('/api/patrol/action-exemptions', { preHandler: requirePermission('view') }, async (_request, reply) => {
    reply.send({ rules: listPatrolActionExemptions() })
  })

  app.put('/api/patrol/action-exemptions', { preHandler: requirePermission('manageTags') }, async (request, reply) => {
    const body = /** @type {{ rules?: unknown }} */ (request.body || {})
    if (!body || !Array.isArray(body.rules)) {
      return reply.code(400).send({ error: 'rules 数组必传（全量覆盖写）' })
    }
    // 重复组合校验（同 userName×apiPath 双全等重复=配置错误）
    const seen = new Set()
    for (const r of body.rules) {
      const key = `${String(r?.userName || '').trim()}\u0000${String(r?.apiPath || '').trim()}`
      if (seen.has(key)) return reply.code(400).send({ error: `重复规则：${String(r?.userName || '')} × ${String(r?.apiPath || '')}` })
      seen.add(key)
    }
    const saved = putPatrolActionExemptions(body.rules, { username: request.user?.username || 'system' })
    clearPatrolActionExemptionsCache() // 写后即时失效缓存（PUT 内已更新，双保险）
    reply.send({ rules: saved })
  })

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

    // ②根因分布（严重度双维度：组数 + 压缩前次数）——11-18 manual 优先（COALESCE 与列表/抽屉同口径）
    const byProductCause = db.prepare(`
      SELECT product_key AS productKey, COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1) AS l1,
             COUNT(*) AS groupCount, SUM(pre_compress_count) AS preCompressTotal
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL ${statusFilter}
      GROUP BY product_key, COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1)
      ORDER BY groupCount DESC
    `).all(start, end)

    // ④L1 趋势（七类全画，缺类 0）
    const L1_KEYS = ['业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败', '资源状态异常', '诊断能力缺口', '其他/未归类']
    /** @type {Array<Record<string, unknown>>} */
    const dailyTrend = []
    const trendRows = db.prepare(`
      SELECT group_date AS date, COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1) AS l1, COUNT(*) AS n
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l1 IS NOT NULL ${statusFilter}
      GROUP BY group_date, COALESCE(NULLIF(root_cause_l1_manual, ''), root_cause_l1)
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
      SELECT COALESCE(NULLIF(root_cause_l2_manual, ''), root_cause_l2) AS l2, group_date AS date, COUNT(*) AS n
      FROM api_patrol_failure_groups
      WHERE group_date BETWEEN ? AND ? AND root_cause_l2 IS NOT NULL ${statusFilter}
      GROUP BY COALESCE(NULLIF(root_cause_l2_manual, ''), root_cause_l2), group_date
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

/**
 * 缺口类型判别（11-19 拍板；11-20 两轮升级：undiagnosed/diagnosis_failed + 枚举真源）：
 * 从 MCP 原始响应 + tools/list 池枚举推断池接入与缺口成因——不维护池清单
 * （覆盖范围会变，静态清单必过时），随诊断数据与 MCP 枚举自动更新。
 * - undiagnosed：从未诊断/超龄收敛（无 diagnoses 记录——不进需求池，单独清单交付补诊断）
 * - diagnosis_failed：诊断调用失败（只有 failed 记录 / raw 为 {"error":...}——MCP 超时/重试失败/
 *   LLM 全败）——组保持 pending_diagnosis 次日自动重试，不纳入需求池任何分区
 * - pool_uncovered：池未接入（**11-20 14:48 拍板判定真源=tools/list 的 poolName 枚举**——
 *   实测枚举外池不报错而静默返回空 records，故「池不在枚举」才是未接入的准确判据；
 *   「调 MCP 报错」反而不证明未接入——接入的池也会临时故障。降级模式（poolInMcpEnum=null，
 *   MCP 清单不可达）回退文本推断：raw 空且池判定降级时保守归此类）
 * - mcp_error：池在枚举内但 MCP 调用报错（raw 空 / 非 JSON 无日志行迹象 / 业务码非 0000）——
 *   临时故障，重诊断可愈；复制清单交付补跑，不进分区一
 * - log_not_collected：日志未采集（code='0000' 但 records=0；非 JSON 旧文本有日志行迹象同判）
 * - failure_log_missing：失败日志缺失（有 records 但无 ERROR/WARN——失败请求只落了 INFO）
 * - other：防御位（有失败语义却判了缺口——理论不出现，不入需求池分区）
 * 11-20 误判修复案：华南-广州3/华北-北京3 实际已接入（枚举内）曾被误报「池未接入」。
 * @param {string | null | undefined} mcpRawResponse
 * @param {boolean} [hasSuccessDiagnosis] 是否存在 success 诊断记录（判定素材来源）
 * @param {boolean} [hasAnyDiagnosis] 是否存在任何 diagnoses 记录（区分「从未诊断」vs「诊断失败待重试」）
 * @param {boolean | null} [poolInMcpEnum] 池是否在 MCP log_search 枚举内：
 *   true=在 / false=不在（分区一真源）/ null=清单不可达（降级文本推断）
 * @returns {'undiagnosed' | 'diagnosis_failed' | 'pool_uncovered' | 'mcp_error' | 'log_not_collected' | 'failure_log_missing' | 'other'}
 */
export function classifyGapKind(mcpRawResponse, hasSuccessDiagnosis = true, hasAnyDiagnosis = hasSuccessDiagnosis, poolInMcpEnum = null) {
  // 无诊断记录=从未诊断（超龄收敛态不写 diagnoses）——非池未接入，单独归类不进需求池
  if (!hasAnyDiagnosis) return 'undiagnosed'
  // 只有 failed 记录=诊断调用失败（MCP 超时/重试失败/LLM 全败）——组保持
  // pending_diagnosis 次日自动重试，不纳入需求池（也不进未诊断清单——那类只收「从未诊断」）
  if (!hasSuccessDiagnosis) return 'diagnosis_failed'
  const raw = String(mcpRawResponse || '').trim()
  // {"error":...} 形态优先于枚举态判定（11-20 修复沿袭）：该形态是诊断调用层失败
  // （超时/HTTP 层）留下的可重试记录——若被枚举外池误读成「池未接入」，会重蹈
  // 华南-广州3 覆辙（重试失败被读成池属性）。成功诊断记录不该有此形态，防历史脏数据。
  if (raw) {
    let early = null
    try { early = JSON.parse(raw) } catch { /* 非 JSON 走下方判定 */ }
    if (early && typeof early === 'object' && early.code == null && early.error != null) {
      return 'diagnosis_failed'
    }
  }
  // 分区一判定真源（11-20 14:48 拍板）：池不在 MCP 枚举=未接入（数据驱动事实；
  // 实测枚举外池静默返回空 records——曾伪装成「日志未采集」混进分区二）
  if (poolInMcpEnum === false) return 'pool_uncovered'
  // raw 空：枚举内=调用异常（mcp_error）；降级模式=保守归 pool_uncovered（11-20 修复沿袭）
  if (!raw) return poolInMcpEnum === true ? 'mcp_error' : 'pool_uncovered'
  let parsed = null
  try { parsed = JSON.parse(raw) } catch {
    // 非 JSON 旧文本形态（fetchPatrolDiagnosticLogs 原样返回路径）：有日志行迹象=MCP 通，
    // 内容无失败行即视为查不到失败日志；无迹象=错误页/异常 → 枚举内 mcp_error / 降级 pool_uncovered
    const hasLogLines = /\[(INFO|ERROR|WARN|DEBUG)\s*\]/i.test(raw) || /\[\d{4}-\d{2}-\d{2}[\s]/.test(raw)
    if (hasLogLines) return 'log_not_collected'
    return poolInMcpEnum === true ? 'mcp_error' : 'pool_uncovered'
  }
  if (String(parsed?.code || '') !== '0000') {
    // 业务错误（枚举内池的临时故障）→ mcp_error；降级模式=pool_uncovered（11-20 修复沿袭）
    return poolInMcpEnum === true ? 'mcp_error' : 'pool_uncovered'
  }
  const recs = Array.isArray(parsed?.data?.records) ? parsed.data.records : []
  if (recs.length === 0) return 'log_not_collected'
  const hasFail = recs.some((r) => /\[(ERROR|WARN)\s*\]/i.test(String(r?.content || '')))
  return hasFail ? 'other' : 'failure_log_missing'
}

/**
 * 诊断结果五段（11-17 拍板：诊断结论/失败组信息/直接原因/关键证据/处理建议）。
 * 服务端切分单源——前端只渲染不重算（同源判定纪律）。
 * - 失败组信息段按方案 A 不重复输出（抽屉顶部 Descriptions 已全量展示）——
 *   此处 failureFacts 仅出精简速览行（接口/池/客户）。
 * - 直接原因：日志 ERROR/WARN 原文行（默认收起，前端双层展开）+「返回:」片段提取。
 * - 关键证据：行级清洗后的证据句（cleanLogLine 与分类器同源）+ errorMessage/errorCode 片段。
 * @param {Record<string, any>} group groups 行（snake_case 原始行）
 * @param {Record<string, any>} diag diagnoses 行
 */
function buildDiagnosisReport(group, diag) {
  const conclusion = String(diag.final_conclusion || '').trim() || null
  const suggestion = String(diag.suggestion || '').trim() || null
  /** @type {{logLines: string[], returnFragments: string[], rawCount: number | null}} */
  // 11-20 19:23 修复：rawCount 语义三分——数字（标准响应可数行）/ null（行数未知：raw 为空或
  // 非标准形态——Plan C 日包曾不推 mcp_raw_response 致部署端恒 0 误显「原始 0 行」）/ 0（确知无内容）。
  // null 时前端不显行数，避免把「未知」当「0 行」误导。
  const directCause = { logLines: [], returnFragments: [], rawCount: null }
  /** @type {string[]} */
  let evidence = []
  const raw = String(diag.mcp_raw_response || '')

  // ---------- 11-17 LLM 结构化产物优先（主路径）：direct_cause/evidence 列（JSON 数组字符串）
  const llmDirect = safeParseStringArray(diag.direct_cause)
  const llmEvidence = safeParseStringArray(diag.evidence)
  if (llmDirect.length > 0) {
    directCause.logLines = llmDirect.map((l) => l.slice(0, 300))
    try {
      const d = JSON.parse(raw)
      if (d?.code === '0000' && Array.isArray(d?.data?.records)) {
        directCause.rawCount = d.data.records.length
      }
    } catch { /* raw 非 JSON（LLM 时代前的旧数据）——rawCount 保持 null */ }
    // raw 确为空（部署端日包断供的存量形态）→ 0：前端按钮隐藏（无内容可展开）
    if (directCause.rawCount === null && !raw) directCause.rawCount = 0
  }
  if (llmEvidence.length > 0) evidence = llmEvidence.map((e) => e.slice(0, 200))

  // ---------- 降级路径（LLM 未产出 / 旧数据）：从 mcp_raw_response 日志行挑选切分（原逻辑）
  if (directCause.logLines.length === 0) {
    try {
      const d = JSON.parse(raw)
      if (d?.code === '0000' && Array.isArray(d?.data?.records)) {
        const lines = d.data.records.map((r) => String(r?.content || '').trim()).filter(Boolean)
        directCause.rawCount = lines.length
        const errLines = lines.filter((l) => /\[\s*(ERROR|WARN|FATAL)\s*\]/.test(l))
        for (const l of (errLines.length > 0 ? errLines : lines).slice(0, 10)) {
          directCause.logLines.push(l.slice(0, 300))
          const rm = /返回[:：]\s*(<\d{3}[^)）]{0,150}|[A-Z0-9_]{3,})/.exec(l)
          if (rm) directCause.returnFragments.push(rm[0].slice(0, 160))
          const cleaned = cleanLogLine(l)
          if (cleaned) evidence.push(cleaned.slice(0, 200))
          const em = /errorMessage=([^,\]]*)/.exec(l)
          if (em && em[1] && em[1] !== 'null') evidence.push(`errorMessage=${em[1].slice(0, 120)}`)
          const ec = /errorCode=([^,\]]*)/.exec(l)
          if (ec && ec[1] && ec[1] !== 'null') evidence.push(`errorCode=${ec[1]}`)
        }
      }
    } catch { /* 非 JSON 原文——直接原因留空，结论照常 */ }
  }

  return {
    conclusion,
    failureFacts: {
      apiPath: String(group.api_path || ''),
      poolName: String(group.pool_name || ''),
      userName: String(group.user_name || ''),
      metricName: String(group.metric_name || ''),
    },
    directCause,
    evidence: [...new Set(evidence)].slice(0, 10),
    suggestion,
    // 11-17 根因来源标注（llm=LLM 结构化诊断 / rule=规则引擎 / null=旧数据）
    rootCauseSource: diag.root_cause_source == null ? null : String(diag.root_cause_source),
  }
}

/** JSON 数组字符串安全解析为 string[]（LLM 五段落库形态：direct_cause/evidence 列）。 */
function safeParseStringArray(v) {
  const raw = String(v || '').trim()
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return parsed.map(String).filter(Boolean)
  } catch {
    return []
  }
}
