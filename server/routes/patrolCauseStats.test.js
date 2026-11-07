import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'

/**
 * API 巡检总览聚合接口 cause-stats（M7）· docs/DESIGN-API巡检.md §7.2。
 * 验收：byProductCause 双维度（组数+压缩前次数）；dailyTrend 七类全画；
 * metricTrends 缺天 null + backfill 补算标记；aiSummaryFacts 与图同源；LLM 未配置模板降级。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-stats-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-stats-xx'

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

const describeStats = sqliteAvailable ? describe : describe.skip

const dbModule = await import('../db.js')
const require_getDb = () => dbModule.getDb()

/** @type {import('fastify').FastifyInstance} */
let app
let token = ''

describeStats('patrol cause-stats 聚合接口', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({
      username: 'patrol_stats_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin',
    })
    token = signAccessToken(admin)

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolQueryRoutes } = await import('./patrolQuery.js')
    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerAuthHooks(app)
    registerPatrolQueryRoutes(app)
    await app.ready()

    seedStats()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const authHeader = () => ({ authorization: `Bearer ${token}` })

  it('byProductCause 双维度：组数 + 压缩前次数（严重度）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/cause-stats?startDate=2026-09-01&endDate=2026-09-02',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    // 种子：业务冲突组2条(preCompress 5+3=8) + 诊断缺口组1条(2) + 未诊断组1条(1)
    const bizConflict = data.byProductCause.find((r) => r.l1 === '业务冲突')
    expect(bizConflict.groupCount).toBe(2)
    expect(bizConflict.preCompressTotal).toBe(8) // 严重度维度（P4 批判修正）
    const diagGap = data.byProductCause.find((r) => r.l1 === '诊断能力缺口')
    expect(diagGap.groupCount).toBe(1)
    expect(diagGap.preCompressTotal).toBe(2)
  })

  it('dailyTrend 七类键全画（缺类为 0）+ 按日计数', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/cause-stats?startDate=2026-09-01&endDate=2026-09-02',
      headers: authHeader(),
    })
    const data = res.json()
    expect(data.dailyTrend).toHaveLength(2) // 两天
    const L1_KEYS = ['业务冲突', '配额不足', '资源锁定/并发冲突', '参数无效/校验失败', '资源状态异常', '诊断能力缺口', '其他/未归类']
    for (const day of data.dailyTrend) {
      for (const k of L1_KEYS) expect(day[k]).toBeGreaterThanOrEqual(0) // 七类全画
    }
    const day1 = data.dailyTrend.find((d) => d.date === '2026-09-01')
    expect(day1['业务冲突']).toBe(1)
    expect(day1['诊断能力缺口']).toBe(1)
  })

  it('metricTrends：推送点 + 缺天 null；backfill 开启补算并标记 backfilled', async () => {
    // 种子：订购 9/1 有 stats(88.89) 9/2 缺 stats；明细 9/2 有 2 行 1 败 → 补算 50%
    const res1 = await app.inject({
      method: 'GET', url: '/api/patrol/cause-stats?startDate=2026-09-01&endDate=2026-09-02',
      headers: authHeader(),
    })
    const trend = res1.json().metricTrends.find((t) => t.metricName === '订购')
    const p9201 = trend.points.find((p) => p.date === '2026-09-01')
    const p9202 = trend.points.find((p) => p.date === '2026-09-02')
    expect(Number(p9201.successRate)).toBeCloseTo(88.89, 1)
    expect(p9202.successRate).toBe(null) // 缺天断线（口径与推送一致）

    const res2 = await app.inject({
      method: 'GET', url: '/api/patrol/cause-stats?startDate=2026-09-01&endDate=2026-09-02&includeBackfill=1',
      headers: authHeader(),
    })
    const trend2 = res2.json().metricTrends.find((t) => t.metricName === '订购')
    const p2 = trend2.points.find((p) => p.date === '2026-09-02')
    expect(Number(p2.successRate)).toBeCloseTo(50, 1) // 明细补算（2 请求 1 成功）
    expect(p2.backfilled).toBe(true) // 空心标记依据
    const p1b = trend2.points.find((p) => p.date === '2026-09-01')
    expect(p1b.backfilled).toBe(false)
  })

  it('aiSummaryFacts 与图同源 + 仿真组计数 + LLM 未配置模板降级', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/cause-stats?startDate=2026-09-01&endDate=2026-09-02',
      headers: authHeader(),
    })
    const data = res.json()
    const facts = data.aiSummaryFacts
    // 同源断言：总组数 = 根因分布 Σ组数 + 未诊断组数（分布只含有 L1 的组）
    const sumGroups = data.byProductCause.reduce((a, r) => a + r.groupCount, 0)
    expect(facts.totalGroups).toBe(sumGroups + facts.undiagnosedGroups)
    // 待处理 = 状态待处理的组数
    expect(facts.pendingGroups).toBe(1)
    // 仿真标签组计数（cmic 测试账号）
    expect(facts.simGroups).toBe(1)
    // LLM 未配置 → 模板直出（aiSummaryText 含 facts 数字锚点描述）
    expect(typeof facts.topCause).toBe('string')
    expect(data.aiSummary.degraded).toBe(true)
    expect(data.aiSummary.text).toContain('失败')
  })
})

/** 种子：4 组（2 业务冲突/1 诊断缺口/1 未诊断 cmic 仿真）+ stats + requests */
function seedStats() {
  const db = require_getDb()
  const insertStat = db.prepare(`
    INSERT INTO api_patrol_stats
      (stat_date, product_key, pool_name, metric_name, api_path, biz_type, success_rate, created_at, updated_at)
    VALUES (?, 'eip', 'p1', '订购', '/customer/v3/order/create/floatingip', '订购', ?, 't', 't')
  `)
  insertStat.run('2026-09-01', 88.89)
  // 9/2 无 stats（缺天）

  const insertReq = db.prepare(`
    INSERT INTO api_patrol_requests
      (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
    VALUES (?, 'p1', 'eip', ?, '/customer/v3/order/create/floatingip', ?, ?, ?, ?, 't')
  `)
  // 9/1：1 失败（对应组1）；9/2：1成1败（backfill 补算 50%）
  insertReq.run('2026-09-01', 'f-1', 'u1', 'YDY15292250571', 0, '2026-09-01 10:00:00')
  insertReq.run('2026-09-02', 'ok-1', 'u1', 'YDY15292250571', 1, '2026-09-02 10:00:00')
  insertReq.run('2026-09-02', 'f-2', 'u1', 'YDY15292250571', 0, '2026-09-02 11:00:00')

  const insertGroup = db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
    VALUES (?, 'eip', 'p1', '/customer/v3/order/create/floatingip', '订购', ?, ?, ?, ?, ?, ?, ?, ?, ?, 't', 't')
  `)
  // 9/1：业务冲突(5) + 诊断缺口(2)
  insertGroup.run('2026-09-01', 'userA', 'f-1', '2026-09-01 10:00:00', 5, '[]', '', '业务冲突', '绑定关系未解除', '待处理')
  insertGroup.run('2026-09-01', 'userB', 'g-2', '2026-09-01 12:00:00', 2, '[]', '', '诊断能力缺口', '日志缺失/无数据', '—')
  // 9/2：业务冲突(3) + 未诊断 cmic 仿真(1)
  insertGroup.run('2026-09-02', 'userA', 'g-3', '2026-09-02 10:00:00', 3, '[]', '', '业务冲突', '绑定关系未解除', '已处理')
  insertGroup.run('2026-09-02', 'cmic_test_x', 'g-4', '2026-09-02 12:00:00', 1, '[]', '测试账号', null, null, 'pending_diagnosis')
}
