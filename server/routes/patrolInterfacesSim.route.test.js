import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 异常接口列表「仿真/测试排后」守卫（2026-11-07 用户拍板，docs/DESIGN-API巡检.md §7.1①）：
 * 纯仿真接口（接口×池×窗口内失败组全为仿真/测试账号）打标签排列表最后；
 * 混合真实客户失败的接口不后排；产品名称/资源池列字段齐备（M6 遗留修正回归）。
 */
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-if-sim-'))
process.env.AUTH_DATABASE_PATH = path.join(TMP_DIR, 't.db')
process.env.SERVER_DATA_DIR = TMP_DIR
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-if-sim-xx'

const sqliteMod = await import('../db.js').catch(() => null)
const sqliteAvailable = Boolean(sqliteMod?.getDb)
const { getDb, closeDb } = sqliteAvailable
  ? /** @type {typeof import('../db.js')} */ (sqliteMod)
  : /** @type {any} */ ({})

describe.skipIf(!sqliteAvailable)('异常接口列表：仿真/测试排后守卫', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null
  let adminToken = ''
  /** @type {any} */ let db = null

  beforeAll(async () => {
    getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()
    db = getDb()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({ username: 't_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin' })
    adminToken = signAccessToken(admin)
    const Fastify = (await import('fastify')).default
    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolQueryRoutes } = await import('./patrolQuery.js')
    app = Fastify({ logger: false })
    registerAuthHooks(app)
    registerPatrolQueryRoutes(app)
    await app.ready()

    const D = '2026-11-06'
    const insStat = db.prepare(`
      INSERT INTO api_patrol_stats (stat_date, product_key, pool_name, api_path, metric_name, biz_type, success_rate, duration_normal_ratio, avg_duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, NULL, NULL, 't', 't')
    `)
    // 真实接口 96%（差点但真实客户问题） vs 纯仿真接口 0%（更差但纯仿真流量）——期望：真实的排第一
    insStat.run(D, 'eip', '华南-广州3', '/customer/v3/order/create', '订购', '订购', 96.0)
    insStat.run(D, 'eip', '华南-广州3', '/sim/only/path', '批量', '其他', 0.0)
    insStat.run(D, 'eip', '华南-广州3', '/mixed/real/sim', '混合', '其他', 88.0) // 混合：真实+仿真失败 → 不算纯仿真
    const insReq = db.prepare(`
      INSERT INTO api_patrol_requests (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
      VALUES (?, '华南-广州3', 'eip', ?, ?, 'u-x', 'userX', 0, ?, 't')
    `)
    insReq.run(D, 'if-1', '/customer/v3/order/create', '2026-11-06 10:00:00')
    insReq.run(D, 'if-2', '/sim/only/path', '2026-11-06 11:00:00')
    insReq.run(D, 'if-3', '/mixed/real/sim', '2026-11-06 12:00:00')
    insReq.run(D, 'if-4', '/not/in/stats/list', '2026-11-06 13:00:00') // 清单外接口失败：同源守卫边界（不在 stats 清单 → 不进列表与概况 failTotal）
    const insGroup = db.prepare(`
      INSERT INTO api_patrol_failure_groups (group_date, product_key, pool_name, api_path, metric_name, user_name,
        first_request_id, first_request_time, pre_compress_count, suppressed_request_ids, customer_type,
        root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
      VALUES (?, 'eip', '华南-广州3', ?, ?, ?, ?, ?, 1, '[]', ?, '资源锁定/并发冲突', '锁定机制待查', '待处理', 't', 't')
    `)
    insGroup.run(D, '/customer/v3/order/create', '订购', 'real-user', 'if-1', '10:00', '普通')
    insGroup.run(D, '/sim/only/path', '批量', 'cmic_sim', 'if-2', '11:00', '仿真')       // 纯仿真接口
    insGroup.run(D, '/mixed/real/sim', '混合', 'real-user', 'if-3a', '12:00', '普通')    // 混合接口：真实
    insGroup.run(D, '/mixed/real/sim', '混合', 'cmic_sim', 'if-3b', '12:30', '仿真')     // 混合接口：仿真
  })

  afterAll(async () => {
    await app?.close()
    closeDb()
  })

  it('① 排序与标签：真实（96%）第一、混合（88%）第二、纯仿真（0%）最后且带 pureSim 标记', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/patrol/failures/interfaces?date=2026-11-06',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    expect(res.statusCode).toBe(200)
    const rows = res.json().rows
    expect(rows.length).toBe(3)
    // 排序=纯仿真最后→<99.5 优先→升序：88（混合）→ 96（真实）→ 0（纯仿真压尾）
    expect(rows[0]).toMatchObject({ apiPath: '/mixed/real/sim', pureSim: false, simGroups: 1 })
    expect(rows[1]).toMatchObject({ apiPath: '/customer/v3/order/create', pureSim: false, simGroups: 0 })
    expect(rows[2]).toMatchObject({ apiPath: '/sim/only/path', pureSim: true, simGroups: 1 })
  })

  it('② 产品名称/资源池字段齐备（M6 遗留修正回归）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/patrol/failures/interfaces?date=2026-11-06',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    const row = res.json().rows[0]
    expect(row.productKey).toBe('eip')
    expect(row.productName).toBe('eip') // 目录未配置时回退 key（temp 库无目录）
    expect(row.pool).toBe('华南-广州3')
  })

  it('③ 巡检概况 facts 与异常接口列表同源（检测视角八项，2026-11-07 拍板）', async () => {
    const qs = 'date=2026-11-06'
    const headers = { authorization: `Bearer ${adminToken}` }
    const res = await app.inject({ method: 'GET', url: `/api/patrol/failures/summary-facts?${qs}`, headers })
    expect(res.statusCode).toBe(200)
    const { facts } = res.json()
    const listRes = await app.inject({ method: 'GET', url: `/api/patrol/failures/interfaces?${qs}`, headers })
    const rows = listRes.json().rows
    // 同源断言：概况数字=列表数字（防文字与表格两张皮）
    expect(facts.interfaceCount).toBe(rows.length)
    expect(facts.failTotal).toBe(rows.reduce((a, r) => a + Number(r.failCount || 0), 0))
    expect(facts.worstTop3[0]).toMatchObject({ apiPath: rows[0].apiPath, pureSim: false })
    expect(facts.belowThresholdCount).toBe(3)
    // 检测视角：覆盖/最集中点（含仿真占比）/根因 Top3/闭环
    expect(facts.productCount).toBe(1)
    expect(facts.poolCount).toBe(1)
    expect(facts.focus).toMatchObject({ apiPath: '/mixed/real/sim', pre: 2, groups: 2, simPre: 1 })
    expect(facts.causeTop3[0]).toMatchObject({ l1: '资源锁定/并发冲突', count: 4, ratio: 100 })
    expect(facts.closure).toMatchObject({ pending: 4, processed: 0, undiagnosed: 0, simGroups: 2 })
    // 环比：上一日无数据 → 失败 +3、接口 +3
    expect(facts.delta).toMatchObject({ prevFailTotal: 0, failDelta: 3, interfaceDelta: 3 })
  })

  it('④ 无 LLM 配置 → 模板直出（degraded），文案含关键数字与仿真/测试标注', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/patrol/failures/summary-facts?date=2026-11-06',
      headers: { authorization: `Bearer ${adminToken}` },
    })
    const { facts, summary } = res.json()
    expect(summary.degraded).toBe(true)
    expect(summary.text).toContain('API 巡检概况')
    expect(summary.text).toContain(`${facts.failTotal} 次`)
    expect(summary.text).toContain('仿真/测试')       // 纯仿真最差接口标注
    expect(summary.text).toContain('资源锁定/并发冲突 100%')
    expect(summary.text).toContain('待产品侧处理 4 组')
    expect(summary.text).toContain('较上一等长周期')
    expect(summary.text).toContain('\n') // 分行排版（2026-11-07 拍板：每行一个焦点）
  })
})
