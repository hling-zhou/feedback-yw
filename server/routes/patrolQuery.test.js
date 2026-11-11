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
    expect(rows.length).toBe(3) // 3 组：诊断缺口的2组 + 待处理1组（见 seedData）
    // L1/L2 Tag 数据直读（不 join）
    const pending = rows.find((r) => r.rootCauseL1 === '业务冲突')
    expect(pending.rootCauseL2).toBe('绑定关系未解除')
    expect(pending.productActionStatus).toBe('待处理')

    // 根因 L1 筛选
    const r1 = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&rootCauseL1=业务冲突',
      headers: authHeader(),
    })
    expect(r1.json().rows).toHaveLength(1)

    // 未诊断状态筛选（PENDING 组）
    const r2 = await app.inject({
      method: 'GET', url: '/api/patrol/failures/groups?startDate=2026-08-10&endDate=2026-08-11&status=未诊断',
      headers: authHeader(),
    })
    expect(r2.json().rows).toHaveLength(1)
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

  // groups：3 组（2 个已诊断 + 1 未诊断）
  const insertGroup = db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
    VALUES (?, 'eip', '华南-广州3', '/customer/v3/order/create/floatingip', ?, ?, ?, ?, ?, '[]', '', ?, ?, ?, 't', 't')
  `)
  insertGroup.run('2026-08-10', '订购', 'YDY15292250571',
    'fail-1', '2026-08-10 19:51:30', 1, '诊断能力缺口', '日志缺失/无数据', '—')
  insertGroup.run('2026-08-11', '订购', 'YDY15292250571',
    'fail-2', '2026-08-11 09:00:00', 1, '业务冲突', '绑定关系未解除', '待处理')
  insertGroup.run('2026-08-11', '订购', 'other-user',
    'fail-3', '2026-08-11 10:00:00', 1, null, null, 'pending_diagnosis')
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
}
