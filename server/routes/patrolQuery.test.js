import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'

/**
 * API 巡检溯源页查询 API（M6.1）· docs/DESIGN-API巡检.md §7.1。
 * 验收：异常接口列表（stats 驱动+明细 Σ 重算+跨日口径+<99.5 优先排序）；
 * 失败请求列表（groups 直读+复合搜索 9 字段+未诊断状态筛选）；
 * 详情（诊断原文+处理闭环 PATCH：提交=已处理/暂存=处理中+审计 before/after）。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-query-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-query-xx'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('../db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

const describeQuery = sqliteAvailable ? describe : describe.skip

/** @type {import('fastify').FastifyInstance} */
let app
/** @type {import('better-sqlite3').Database} */
let db
let token = ''

describeQuery('patrol query API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    db = getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({
      username: 'patrol_query_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin',
    })
    token = signAccessToken(admin)

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolQueryRoutes } = await import('./patrolQuery.js')
    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerAuthHooks(app)
    registerPatrolQueryRoutes(app)
    await app.ready()

    seedData()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const authHeader = () => ({ authorization: `Bearer ${token}` })
  const authHeaderJson = () => ({ authorization: `Bearer ${token}`, 'content-type': 'application/json' })


  // ── ①异常接口列表 ──
  it('单日：成功率/次数从明细重算（对拍手工值）+ <99.5% 优先在前', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/interfaces?date=2026-08-10',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    // 广州3 订购：1 失败 8 成功 → 重算 88.89%（与 stats 推送值一致）
    const order = rows.find((r) => r.pool === '华南-广州3' && r.metricName === '订购')
    expect(order).toBeTruthy()
    expect(order.totalCount).toBe(9)
    expect(order.failCount).toBe(1)
    expect(Number(order.successRate)).toBeCloseTo(88.89, 1)
    // 排序：<99.5% 在前（广州3 订购 88.89% 应在 96.72% 前）
    const idxA = rows.findIndex((r) => r.pool === '华南-广州3' && r.metricName === '订购')
    const idxB = rows.findIndex((r) => r.metricName === '绑定' && r.successRate === 96.72)
    expect(idxA).toBeLessThan(idxB)
  })

  it('跨日（range=custom 7d）：成功率/次数=Σ 加权重算；时长均值/正常比例=null（跨日显示—）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/interfaces?startDate=2026-08-10&endDate=2026-08-11',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    const order = rows.find((r) => r.pool === '华南-广州3' && r.metricName === '订购')
    // 两日合计：8月10 9行（8成1败）+ 8月11 2行（fail-2+fail-3 全败）= 11 请求 3 失败 → 72.73%
    expect(order.totalCount).toBe(11)
    expect(order.failCount).toBe(3)
    expect(Number(order.successRate)).toBeCloseTo(72.73, 1)
    // 跨日 avg_duration=null（C 拍板：跨日显示"—"）
    expect(order.avgDuration).toBe(null)
    expect(order.durationNormalRatio).toBe(null)
  })

  it('stats 有行但当日无明细 → 次数 0 不 crash（边界 §3.5）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/interfaces?date=2026-08-12',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    const lonely = rows.find((r) => r.metricName === '续订')
    expect(lonely).toBeTruthy()
    expect(lonely.totalCount).toBe(0)
    expect(lonely.failCount).toBe(0)
  })

  // ── ②失败请求列表（复合搜索）──
  it('groups 直读：L1·L2 回传 + 复合搜索（根因 L1 过滤/未诊断状态筛选）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    expect(rows.length).toBe(4) // 4 组：诊断缺口2 + 待处理1 + 未诊断1 + slb对照1（11-17 产品筛选用）
    // L1/L2 Tag 数据直读（不 join；11-18 manual 列也回传——前端 displayRootCause 做优先派生）
    const pending = rows.find((r) => r.rootCauseL1 === '业务冲突')
    expect(pending.rootCauseL2).toBe('绑定关系未解除')
    expect(pending.productActionStatus).toBe('待处理')
    expect(pending.rootCauseL1Manual).toBe('参数无效/校验失败')
    expect(pending.rootCauseL2Manual).toBe('传参缺失')

    // 根因 L1 筛选——11-19 升级 COALESCE 有效根因口径：fail-2 已被 manual 修正为
    // 「参数无效/校验失败」，按业务冲突筛选不再命中（旧口径下命中=红绿证明点）
    const r1 = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&rootCauseL1=业务冲突',
      headers: authHeader(),
    })
    expect(r1.json().rows).toHaveLength(0)
    // 有效根因筛选：修正值可筛到（manual 优先）
    const r1b = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&rootCauseL1=' + encodeURIComponent('参数无效/校验失败'),
      headers: authHeader(),
    })
    expect(r1b.json().rows).toHaveLength(1)
    expect(r1b.json().rows[0].firstRequestId).toBe('fail-2')
    // L2 有效口径：manual L2（传参缺失）可筛，原 L2（绑定关系未解除）不再命中 fail-2
    const r1c = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&rootCauseL2=' + encodeURIComponent('绑定关系未解除'),
      headers: authHeader(),
    })
    expect(r1c.json().rows).toHaveLength(0)
    // 下钻参数：poolName 等值 + apiPathExact 精确（与 rootCauseL1 组合）
    const r1d = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&rootCauseL1=' + encodeURIComponent('诊断能力缺口') + '&poolName=' + encodeURIComponent('华南-广州3'),
      headers: authHeader(),
    })
    expect(r1d.json().rows).toHaveLength(1) // 缺口组在华南-广州3（fail-1）
    const r1e = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&rootCauseL1=' + encodeURIComponent('诊断能力缺口') + '&poolName=' + encodeURIComponent('华北-北京3'),
      headers: authHeader(),
    })
    expect(r1e.json().rows).toHaveLength(0)
    const r1f = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&apiPathExact=' + encodeURIComponent('/customer/v3/order/create/floatingip') + '&poolName=' + encodeURIComponent('华南-广州3'),
      headers: authHeader(),
    })
    expect(r1f.json().rows).toHaveLength(3) // fail-1(缺口)+fail-2(修正)+fail-3(未诊断) 同接口同池

    // 未诊断状态筛选（PENDING 组——11-17 加 slb 对照组后为 2：fail-3 + fail-s1）
    const r2 = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&status=未诊断',
      headers: authHeader(),
    })
    expect(r2.json().rows).toHaveLength(2)
  })

  it('需产品侧处理快捷筛选包含待处理、处理中、已处理，排除其他状态', async () => {
    const query = () => app.inject({
      method: 'GET',
      url: `/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&status=${encodeURIComponent('需产品侧处理')}`,
      headers: authHeader(),
    })
    const updateStatus = db.prepare('UPDATE api_patrol_failure_groups SET product_action_status=? WHERE first_request_id=?')
    try {
      const pendingOnly = await query()
      expect(pendingOnly.statusCode).toBe(200)
      expect(pendingOnly.json().rows.map((row) => row.productActionStatus)).toEqual(['待处理'])

      updateStatus.run('处理中', 'fail-1')
      const inProgress = await query()
      expect(inProgress.json().rows.map((row) => row.productActionStatus).sort()).toEqual(['处理中', '待处理'].sort())

      updateStatus.run('已处理', 'fail-3')
      const processed = await query()
      expect(processed.json().rows.map((row) => row.productActionStatus).sort()).toEqual(['处理中', '已处理', '待处理'].sort())
    } finally {
      updateStatus.run('—', 'fail-1')
      updateStatus.run('pending_diagnosis', 'fail-3')
    }
  })

  it('概况统计 manual 优先（11-18 拍板：L1 分布/L2 聚合/趋势与列表同口径——人工修正后统计按修正类归）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/cause-stats?startDate=2026-08-10&endDate=2026-08-11',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    // fail-2 组 AI 原判=业务冲突，人工修正=参数无效/校验失败——
    // ②产品×L1 分布须按修正类归（修正类出现、原判类退场）
    const eipRows = (data.byProductCause || []).filter((r) => r.productKey === 'eip')
    expect(eipRows.some((r) => r.l1 === '参数无效/校验失败')).toBe(true)
    expect(eipRows.some((r) => r.l1 === '业务冲突')).toBe(false)
    // ①facts.topCause（主要根因）同口径：修正后窗口内最高根因=参数无效/校验失败（缺口类 2 组不带 statusFilter 时占多，
    //   但 topCause 判定在 pendingOnly=1 下验证——只看待处理组，修正组是唯一待处理组）
    const r2 = await app.inject({
      method: 'GET', url: '/api/patrol/cause-stats?startDate=2026-08-10&endDate=2026-08-11&pendingOnly=1',
      headers: authHeader(),
    })
    const facts2 = r2.json().aiSummaryFacts || {}
    expect(facts2.topCause).toBe('参数无效/校验失败')
  })

  it('详情：诊断原文 + 处理字段', async () => {
    const groups = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE root_cause_l1='业务冲突'`).get()
    const res = await app.inject({
      method: 'GET', url: `/api/patrol/failures/groups/${groups.id}`,
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.group).toBeTruthy()
    expect(data.diagnosis.finalConclusion).toContain('存在绑定关系')
    // 11-20 19:23 修复：rawCount 语义——seed 诊断 raw='{}'（非标准形态）→ null（行数未知，非 0）
    expect(data.diagnosisReport.directCause.rawCount).toBeNull()
  })

  // ── ②'经办人筛选 + 选项端点（11-17）──
  it('assignees 选项端点：DISTINCT 非空经办人 + 组数计数；空经办人不出现', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/assignees?startDate=2026-08-10&endDate=2026-08-11',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    // seedData 有 fanhaoyu（2 组）+ 一组空 assignee——空值必须被排除
    const names = rows.map((r) => r.assignee)
    expect(names).toContain('fanhaoyu')
    expect(names.every((n) => n && n.trim() !== '')).toBe(true)
    expect(rows.find((r) => r.assignee === 'fanhaoyu').count).toBe(2)
  })

  it('groups 经办人筛选（assignee 精确匹配）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&assignee=fanhaoyu',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.every((r) => r.assignee === 'fanhaoyu')).toBe(true)
    // 无匹配经办人 → 空列表（非报错）
    const none = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&assignee=不存在的人',
      headers: authHeader(),
    })
    expect(none.json().rows).toHaveLength(0)
  })

  // ── ②''产品筛选 + 分产品计数（11-17）──
  it('product-counts 端点：双口径计数（接口行数/组数）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/product-counts?startDate=2026-08-10&endDate=2026-08-11',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    const eip = rows.find((r) => r.key === 'eip')
    const slb = rows.find((r) => r.key === 'slb')
    // eip：stats 4 行（8-10 两行 + 8-11 两行）+ 孤行 8-12 不在窗口内；组 4（fail-1/2/3）
    expect(eip.interfaceCount).toBe(4)
    expect(eip.groupCount).toBe(3)
    // slb：stats 1 行 + 组 1
    expect(slb.interfaceCount).toBe(1)
    expect(slb.groupCount).toBe(1)
    // 零计数产品不出现
    expect(rows.some((r) => r.interfaceCount === 0 && r.groupCount === 0)).toBe(false)
  })

  it('interfaces 产品过滤：product=slb 只剩 slb 接口行', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/interfaces?startDate=2026-08-10&endDate=2026-08-11&product=slb',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    expect(rows.length).toBe(1)
    expect(rows[0].productKey).toBe('slb')
    expect(rows[0].apiPath).toBe('LOADBALANCER/CREATE')
    // 不带 product → 跨日合并后全量 3 行：广州3订购（2日合1）+ 济南绑定（2日合1）+ slb 1
    const all = await app.inject({
      method: 'GET', url: '/api/patrol/failures/interfaces?startDate=2026-08-10&endDate=2026-08-11',
      headers: authHeader(),
    })
    expect(all.json().rows.length).toBe(3)
  })

  it('groups 产品过滤：product=slb 只剩 slb 组', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&product=slb',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    expect(rows.length).toBe(1)
    expect(rows[0].productKey).toBe('slb')
    expect(rows[0].firstRequestId).toBe('fail-s1')
  })

  // ── ③处理闭环 PATCH ──
  it('提交反馈 → 已处理 + 审计 before/after；暂存 → 处理中', async () => {
    const groups = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE root_cause_l1='业务冲突'`).get()
    // 提交
    const res1 = await app.inject({
      method: 'PATCH', url: `/api/patrol/failures/groups/${groups.id}`,
      headers: authHeader(),
      payload: {
        action: 'submit',
        rootCauseConfirmed: '属实',
        measureFeedback: '已排期 v1.2 修复',
        assignee: '张三',
      },
    })
    expect(res1.statusCode).toBe(200)
    expect(res1.json().group.productActionStatus).toBe('已处理')
    // 审计 before/after
    const { listAuditLogs } = await import('../audit.js')
    const entries = listAuditLogs(3).filter((e) => e.action === 'api_patrol.group_update')
    expect(entries.length).toBeGreaterThan(0)
    const detail = entries[0].detail
    expect(detail.before.productActionStatus).toBe('待处理')
    expect(detail.after.productActionStatus).toBe('已处理')
    expect(detail.groupId).toBe(groups.id)

    // 暂存
    const res2 = await app.inject({
      method: 'PATCH', url: `/api/patrol/failures/groups/${groups.id}`,
      headers: authHeader(),
      payload: { action: 'draft', measureFeedback: '部分更新' },
    })
    expect(res2.statusCode).toBe(200)
    expect(res2.json().group.productActionStatus).toBe('处理中')
  })

  it('不属实 → 必须填真实根因（校验拦截）', async () => {
    const groups = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE product_action_status='待处理' OR product_action_status='处理中' OR product_action_status='已处理'`).get()
    const res = await app.inject({
      method: 'PATCH', url: `/api/patrol/failures/groups/${groups.id}`,
      headers: authHeader(),
      payload: { action: 'submit', rootCauseConfirmed: '不属实' }, // 缺 realRootCause
    })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toContain('真实根因')
  })

  // ── ③c 历史 pending 转待处理端点（11-20 15:09 拍板）──
  it('trapped-pending：今日诊断转出的历史待处理组返回；报告日内/无今日诊断/非待处理组排除；清诊断后空', async () => {
    // seed 态：fail-2（业务冲突·待处理·2026-08-11 历史日期）有 success 诊断但 diagnosed_at='t'（非今日）→ 不返回
    const res0 = await app.inject({
      method: 'GET', url: '/api/patrol/failures/trapped-pending',
      headers: authHeader(),
    })
    expect(res0.statusCode).toBe(200)
    expect(res0.json().rows).toEqual([])       // 无今日诊断——空（改前红：判定漏 diagnoses 锚点会带出 fail-2）

    // 构造 trapped 场景：fail-2（前序用例已流转为「处理中」）重置回「待处理」+ 追加今日 success 诊断；
    // fail-1（'—' 状态）加今日诊断（非待处理→排除）
    db.prepare(`UPDATE api_patrol_failure_groups SET product_action_status='待处理' WHERE first_request_id='fail-2'`).run()
    const g2 = db.prepare(`SELECT id FROM api_patrol_failure_groups WHERE first_request_id='fail-2'`).get()
    const g1 = db.prepare(`SELECT id FROM api_patrol_failure_groups WHERE first_request_id='fail-1'`).get()
    const todayIso = new Date().toISOString()
    const insDiag = db.prepare(`
      INSERT INTO api_patrol_diagnoses
        (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion, root_cause_l1, root_cause_l2, root_cause_source, diagnosed_at)
      VALUES (?, ?, 'success', 'log_search', '{}', '结论', '业务冲突', '绑定关系未解除', 'llm', ?)
    `)
    insDiag.run(g2.id, 'fail-2', todayIso)
    insDiag.run(g1.id, 'fail-1', todayIso)    // fail-1 是 '—'——今日诊断但不待处理，须排除
    // 另插一个「报告日内待处理组 + 今日诊断」——group_date=今日 → 不 trapped（日期窗口内属正常流转）
    db.prepare(`
      INSERT INTO api_patrol_failure_groups
        (group_date, product_key, pool_name, api_path, metric_name, user_name,
         first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
         customer_type, root_cause_l1, root_cause_l2, product_action_status, assignee, created_at, updated_at)
      VALUES (date('now','localtime'), 'eip', '华南-广州3', '/acl/v3/floatingip/bind', '绑定', 'u9',
              'fail-today', 't', 1, '[]', '', '业务冲突', '绑定关系未解除', '待处理', null, 't', 't')
    `).run()
    const gToday = db.prepare(`SELECT id FROM api_patrol_failure_groups WHERE first_request_id='fail-today'`).get()
    insDiag.run(gToday.id, 'fail-today', todayIso)

    const res = await app.inject({
      method: 'GET', url: '/api/patrol/failures/trapped-pending',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    expect(data.count).toBe(1)                // 只有 fail-2（fail-1 非'待处理'、fail-today 日期=今日）
    expect(data.rows).toHaveLength(1)
    const row = data.rows[0]
    expect(row.firstRequestId).toBe('fail-2')
    expect(row.productName).toBeTruthy()      // productName 解析（目录回退 key）
    expect(row.groupDate).toBe('2026-08-11')
    expect(row.preCompressCount).toBe(1)
    expect(row.poolName).toBe('华南-广州3')

    // 负例：清今日诊断 → 空（次日自动消失语义——判定锚定 diagnoses 今日 success）
    db.prepare(`DELETE FROM api_patrol_diagnoses WHERE diagnosed_at = ?`).run(todayIso)
    const res2 = await app.inject({
      method: 'GET', url: '/api/patrol/failures/trapped-pending',
      headers: authHeader(),
    })
    expect(res2.statusCode).toBe(200)
    expect(res2.json().rows).toEqual([])
  })

  // ── ③b 处理闭环权限（11-20 拍板：manageTags → editRecord）──
  it('partial_editor 可提交处理反馈；viewer 403（editRecord 门控红绿）', async () => {
    const { createUser: createUser2 } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const groups = db.prepare(`SELECT * FROM api_patrol_failure_groups LIMIT 1`).get()
    expect(groups).toBeTruthy() // 权限验证不依赖起始状态——draft 直接置「处理中」；前序用例已消费种子组

    // partial_editor（无 manageTags、有 editRecord）→ 200：证明门控已从 manageTags 收敛
    const pe = await createUser2({ username: 'patrol_query_pe', password: 'PePass12345!', team: '综合管理组', role: 'partial_editor' })
    const peRes = await app.inject({
      method: 'PATCH', url: `/api/patrol/failures/groups/${groups.id}`,
      headers: { authorization: `Bearer ${signAccessToken(pe)}` },
      payload: { action: 'draft', measureFeedback: '部分编辑暂存', assignee: '部分编辑' },
    })
    expect(peRes.statusCode).toBe(200)
    expect(peRes.json().group.productActionStatus).toBe('处理中')

    // viewer（无 editRecord）→ 403
    const viewer = await createUser2({ username: 'patrol_query_viewer', password: 'ViewerPass12345!', team: '综合管理组', role: 'viewer' })
    const viewerRes = await app.inject({
      method: 'PATCH', url: `/api/patrol/failures/groups/${groups.id}`,
      headers: { authorization: `Bearer ${signAccessToken(viewer)}` },
      payload: { action: 'draft', measureFeedback: '查看者不应成功' },
    })
    expect(viewerRes.statusCode).toBe(403)
  })
})

/** 种子数据：单日+跨日 stats/requests/groups/diagnoses 完整场景 */
function seedData() {
  const insertStat = db.prepare(`
    INSERT INTO api_patrol_stats
      (stat_date, product_key, pool_name, metric_name, api_path, biz_type, success_rate,
       duration_normal_ratio, avg_duration, created_at, updated_at)
    VALUES (?, 'eip', ?, ?, ?, ?, ?, ?, ?, 't', 't')
  `)
  // 8月10日：订购 88.89（重算对拍）+ 绑定 96.72；8月11日：订购 50 + 绑定 100（跨日 Σ）
  insertStat.run('2026-08-10', '华南-广州3', '订购', '/customer/v3/order/create/floatingip', '订购', 88.89, 87.5, '29.27s')
  insertStat.run('2026-08-10', '华东-济南', '绑定', '/acl/v3/floatingip/bind', '绑定', 96.72, null, null)
  insertStat.run('2026-08-11', '华南-广州3', '订购', '/customer/v3/order/create/floatingip', '订购', 50, 90, '30.00s')
  insertStat.run('2026-08-11', '华东-济南', '绑定', '/acl/v3/floatingip/bind', '绑定', 100, null, null)
  // 孤行：当日无明细
  insertStat.run('2026-08-12', '华南-广州3', '续订', '/customer/v3/order/renew', '续订', 99.0, null, null)
  // 11-17 产品筛选对照：slb 一条 stats + 一个组（对照产品）。
  // 注意：insertStat 写死 product_key='eip'——slb 行必须独立 INSERT，别复用。
  db.prepare(`
    INSERT INTO api_patrol_stats
      (stat_date, product_key, pool_name, metric_name, api_path, biz_type, success_rate,
       duration_normal_ratio, avg_duration, created_at, updated_at)
    VALUES ('2026-08-10', 'slb', '华北-北京3', '负载均衡', 'LOADBALANCER/CREATE', '订购', 80, null, null, 't', 't')
  `).run()
  db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2, product_action_status, assignee, created_at, updated_at)
    VALUES ('2026-08-11', 'slb', '华北-北京3', 'LOADBALANCER/CREATE', '负载均衡', 'userS', 'fail-s1', '2026-08-11 12:00:00', 1, '[]', '', null, null, 'pending_diagnosis', null, 't', 't')
  `).run()

  const insertReq = db.prepare(`
    INSERT INTO api_patrol_requests
      (request_date, pool_name, product_key, request_id, api_path, user_id, user_name,
       is_success, request_time, created_at)
    VALUES (?, '华南-广州3', 'eip', ?, '/customer/v3/order/create/floatingip', 'u1', 'YDY15292250571', ?, ?, 't')
  `)
  // 8月10日：8 成功 1 失败
  for (let i = 0; i < 8; i++) insertReq.run('2026-08-10', `ok-${i}`, 1, `2026-08-10 10:0${i}:00`)
  insertReq.run('2026-08-10', 'fail-1', 0, '2026-08-10 19:51:30')
  // 8月11日：1 失败
  insertReq.run('2026-08-11', 'fail-2', 0, '2026-08-11 09:00:00')

  // groups：3 组（2 个已诊断 + 1 未诊断）；11-17 经办人筛选：fail-1/fail-2=fanhaoyu、fail-3 空（选项端点须排除空值）
  const insertGroup = db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2, product_action_status, assignee, created_at, updated_at)
    VALUES (?, 'eip', '华南-广州3', '/customer/v3/order/create/floatingip', ?, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 't', 't')
  `)
  insertGroup.run('2026-08-10', '订购', 'YDY15292250571',
    'fail-1', '2026-08-10 19:51:30', 1, '[]', '诊断能力缺口', '日志缺失/无数据', '—', 'fanhaoyu')
  insertGroup.run('2026-08-11', '订购', 'YDY15292250571',
    'fail-2', '2026-08-11 09:00:00', 1, '[]', '业务冲突', '绑定关系未解除', '待处理', 'fanhaoyu')
  insertGroup.run('2026-08-11', '订购', 'other-user',
    'fail-3', '2026-08-11 10:00:00', 1, '[]', null, null, 'pending_diagnosis', null)
  // 为未诊断组补 requests 行（fail-3）
  insertReq.run('2026-08-11', 'fail-3', 0, '2026-08-11 10:00:00')

  const insertDiag = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, diagnosed_at)
    VALUES (?, ?, 'success', 'log_search', '{}', ?, ?, ?, 't')
  `)
  const g2 = db.prepare(`SELECT id FROM api_patrol_failure_groups WHERE root_cause_l1='业务冲突'`).get()
  insertDiag.run(g2.id, 'fail-2', '存在绑定关系需先解绑再退订', '业务冲突', '绑定关系未解除')

  // 11-18 人工修正种子：fail-2 组被人工修正为「参数无效/校验失败/传参缺失」——
  // 概况统计（L1 分布/L2 聚合/趋势）须 manual 优先（同源判定纪律——与列表/抽屉同口径）
  db.prepare(`UPDATE api_patrol_failure_groups SET root_cause_l1_manual='参数无效/校验失败', root_cause_l2_manual='传参缺失' WHERE id=?`).run(g2.id)
}
