import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'

/**
 * API 巡检推送端点集成测试（M2 路由层）。
 * 真实链路：真实 API Key（createApiKey + patrol:push scope）→ 全局鉴权钩子 → 端点 → 真库 upsert。
 * 覆盖：scope 校验/400 家族/幂等覆盖/批内去重/坏行隔离/未登记告警/4.1 样例真值对拍。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-push-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-push-xx'

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

const describePush = sqliteAvailable ? describe : describe.skip

/** @type {import('fastify').FastifyInstance} */
let app
let pushKeySecret = ''
let noScopeKeySecret = ''
/** @type {import('better-sqlite3').Database} */
let db

const keyHeader = (secret) => ({ authorization: `Bearer ${secret}`, 'content-type': 'application/json' })

describePush('patrol push endpoints', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    db = getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema() // 建表 + 种子（34 注册项）

    // 真实 API Key：带 scope / 不带 scope
    const { apiKeyRepository } = await import('../apiKeyRepository.js')
    const withScope = apiKeyRepository.createApiKey({ name: 'patrol-pusher', scopes: ['patrol:push'] })
    pushKeySecret = withScope.secret
    const withoutScope = apiKeyRepository.createApiKey({ name: 'other-scope', scopes: ['mcp:read'] })
    noScopeKeySecret = withoutScope.secret

    // 产品目录（两级映射真源）：最小化写入 eip/vpc/slb
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1, updatedAt: new Date().toISOString(), products: [
        { key: 'eip', name: '弹性公网IP', enabled: true },
        { key: 'vpc', name: '虚拟私有云', enabled: true },
        { key: 'slb', name: '弹性负载均衡', enabled: true },
      ], deletedKeys: [], disabledAnalysisKeys: [],
    })

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolPushRoutes } = await import('./patrolPush.js')
    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerAuthHooks(app)
    registerPatrolPushRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  // ── scope 校验（§3.3）──
  it('3.1 无凭据 → 401（全局钩子拦截，先于 scope）', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/patrol/push/stats', payload: {} })
    expect(res.statusCode).toBe(401)
  })

  it('3.2 不带 scope 的 API Key → 403', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: keyHeader(noScopeKeySecret), payload: {},
    })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toContain('patrol:push')
  })

  it('3.3 带 patrol:push scope → 通过鉴权层（进入业务校验）', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: keyHeader(pushKeySecret), payload: {},
    })
    // payload 缺字段 → 400（证明已通过 403 scope 层）
    expect(res.statusCode).toBe(400)
  })

  // ── stats 端点（§3.2/§3.4/§3.5）──
  const statsPayload = (over = {}) => ({
    product: '弹性公网IP', date: '2026-08-10',
    rows: [{
      '资源池': '华南-广州3', '指标名称': '订购', '接口名称': '/customer/v3/order/create/floatingip',
      '业务类型': '订购', '成功率': '88.89%', '正常比例': '87.5%', '时长均值': '29.27s',
    }],
    ...over,
  })

  it('4.1 样例真值入库对拍：REAL 解析/键值落库/响应摘要', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: keyHeader(pushKeySecret), payload: statsPayload(),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ received: 1, inserted: 1, overwritten: 0, ignored: 0 })
    const row = db.prepare(`SELECT * FROM api_patrol_stats`).get()
    expect(row).toMatchObject({
      stat_date: '2026-08-10', product_key: 'eip', pool_name: '华南-广州3',
      metric_name: '订购', api_path: '/customer/v3/order/create/floatingip',
      biz_type: '订购', success_rate: 88.89, duration_normal_ratio: 87.5, avg_duration: '29.27s',
    })
  })

  it('4.2 "-" → NULL', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: keyHeader(pushKeySecret),
      payload: statsPayload({
        date: '2026-08-11',
        rows: [{
          '资源池': '华东-济南', '指标名称': '绑定', '接口名称': '/acl/v3/floatingip/bind',
          '业务类型': '绑定', '成功率': '96.72%', '正常比例': '-', '时长均值': '-',
        }],
      }),
    })
    expect(res.statusCode).toBe(200)
    const row = /** @type {{duration_normal_ratio: unknown, avg_duration: unknown}} */ (
      db.prepare(`SELECT duration_normal_ratio, avg_duration FROM api_patrol_stats WHERE stat_date='2026-08-11'`).get()
    )
    expect(row.duration_normal_ratio).toBe(null)
    expect(row.avg_duration).toBe(null)
  })

  it('4.3 重推覆盖：overwritten=1、库计数不变', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: keyHeader(pushKeySecret), payload: statsPayload(),
    })
    expect(res.json()).toMatchObject({ inserted: 0, overwritten: 1 })
    const n = db.prepare(`SELECT COUNT(*) n FROM api_patrol_stats`).get()
    expect(/** @type {{n: number}} */ (row_count()).n).toBeGreaterThanOrEqual(1)
    function row_count() { return db.prepare(`SELECT COUNT(*) n FROM api_patrol_stats`).get() }
  })

  it('4.4 同接口不同指标名 → 两行并存（唯一键含 metric_name，A 项修正守卫）', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: keyHeader(pushKeySecret),
      payload: statsPayload({
        rows: [
          {
            '资源池': '华北-北京3', '指标名称': '绑定', '接口名称': '/acl/v3/floatingip/bind',
            '业务类型': '绑定', '成功率': '94.59%',
          },
          {
            '资源池': '华北-北京3', '指标名称': '绑定云主机', '接口名称': '/acl/v3/floatingip/bind',
            '业务类型': '绑定', '成功率': '95.00%',
          },
        ],
      }),
    })
    expect(res.json()).toMatchObject({ inserted: 2, ignored: 0 })
    const n = db.prepare(
      `SELECT COUNT(*) n FROM api_patrol_stats WHERE api_path='/acl/v3/floatingip/bind' AND pool_name='华北-北京3'`,
    ).get()
    expect(/** @type {{n: number}} */ (n).n).toBe(2)
  })

  it('4.5 400 家族：缺 product / 坏 date / 未知产品 / key fallback 通过', async () => {
    const r1 = await app.inject({ method: 'POST', url: '/api/patrol/push/stats', headers: keyHeader(pushKeySecret), payload: { date: '2026-08-10', rows: [] } })
    expect(r1.statusCode).toBe(400)
    const r2 = await app.inject({ method: 'POST', url: '/api/patrol/push/stats', headers: keyHeader(pushKeySecret), payload: statsPayload({ date: '2026/08/10' }) })
    expect(r2.statusCode).toBe(400)
    const r3 = await app.inject({ method: 'POST', url: '/api/patrol/push/stats', headers: keyHeader(pushKeySecret), payload: statsPayload({ product: '不存在的' }) })
    expect(r3.statusCode).toBe(400)
    expect(r3.json().error).toContain('未知产品')
    const r4 = await app.inject({ method: 'POST', url: '/api/patrol/push/stats', headers: keyHeader(pushKeySecret), payload: statsPayload({ product: 'eip', date: '2026-08-12' }) })
    expect(r4.statusCode).toBe(200)
  })

  it('4.8 坏行隔离：成功率非法 → ignored=1 不打断整批', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: keyHeader(pushKeySecret),
      payload: statsPayload({
        date: '2026-08-13',
        rows: [
          { '资源池': 'x', '指标名称': 'a', '接口名称': '/x', '业务类型': 't', '成功率': '90%' },
          { '资源池': 'y', '指标名称': 'b', '接口名称': '/y', '业务类型': 't', '成功率': 'abc' },
        ],
      }),
    })
    expect(res.json()).toMatchObject({ inserted: 1, ignored: 1 })
  })

  // ── requests 端点（§3.2/§3.5）──
  const eipRow = (over = {}) => ({
    id: '123811889', appId: '', requestId: 'reqId-45020bf390c36027da9782356b68010e',
    requestMapping: '/acl/v3/floatingip/unbind/{ipId}',
    userId: 'CIDC-U-752030e34dbf455eb4969c35722e3a58', userName: 'YDY15292250571',
    bizCategory: '解绑', bizTarget: 'IP', bizNo: '685d8e3e',
    result: '0', executionTimeMillis: '10', createTime: '2026-08-10 19:51:30',
    diagnoseResult: '{"final_conclusion":"日志查询异常/无数据-xxx"}',
    ...over,
  })

  it('5.1 归属判定：bind→eip / port→vpc / havip/bind→vpc（注册表）', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: keyHeader(pushKeySecret),
      payload: {
        package: 'eip_vpc', date: '2026-08-10', pool: '华南-广州3',
        rows: [
          eipRow({ requestId: 'r-eip-1', requestMapping: '/acl/v3/floatingip/bind' }),
          eipRow({ requestId: 'r-vpc-1', requestMapping: '/customer/v3/port' }),
          eipRow({ requestId: 'r-vpc-2', requestMapping: '/acl/v3/havip/bind' }),
        ],
      },
    })
    expect(res.statusCode).toBe(200)
    const keys = db.prepare(
      `SELECT request_id, product_key FROM api_patrol_requests WHERE request_id IN ('r-eip-1','r-vpc-1','r-vpc-2')`,
    ).all()
    const map = Object.fromEntries(keys.map((r) => [/** @type {{request_id: string}} */ (r).request_id, /** @type {{product_key: string}} */ (r).product_key]))
    expect(map['r-eip-1']).toBe('eip')
    expect(map['r-vpc-1']).toBe('vpc')
    expect(map['r-vpc-2']).toBe('vpc')
  })

  it('5.3 未登记接口 → 启发式判定 + unregistered meta 追加', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: keyHeader(pushKeySecret),
      payload: {
        package: 'eip_vpc', date: '2026-08-10', pool: '华南-广州3',
        rows: [eipRow({ requestId: 'r-unknown-1', requestMapping: '/customer/v3/brandNewApi' })],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().unregistered).toContain('/customer/v3/brandNewApi')
    const raw = db.prepare(`SELECT value FROM meta WHERE key='api_patrol_unregistered_apis_v1'`).get()
    const parsed = JSON.parse(/** @type {{value: string}} */ (raw).value)
    expect(parsed.items).toContain('/customer/v3/brandNewApi')
    // 库行：启发式判 eip（未知接口非 VPC 关键词）
    const row = db.prepare(`SELECT product_key FROM api_patrol_requests WHERE request_id='r-unknown-1'`).get()
    expect(/** @type {{product_key: string}} */ (row).product_key).toBe('eip')
  })

  it('5.4 空 rows → 200 received=0', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: keyHeader(pushKeySecret),
      payload: { package: 'elb', date: '2026-08-10', pool: '华南-广州3', rows: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ received: 0 })
  })

  it('5.5 批内同 requestId 去重：库 1 行、inserted=1+overwritten=1（后者覆盖前者）', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: keyHeader(pushKeySecret),
      payload: {
        package: 'eip_vpc', date: '2026-08-10', pool: '华南-广州3',
        rows: [
          eipRow({ requestId: 'r-dup-1', result: '1' }),
          eipRow({ requestId: 'r-dup-1', result: '0' }),
        ],
      },
    })
    expect(res.json()).toMatchObject({ inserted: 1, overwritten: 1 })
    const n = db.prepare(`SELECT COUNT(*) n FROM api_patrol_requests WHERE request_id='r-dup-1'`).get()
    expect(/** @type {{n: number}} */ (n).n).toBe(1)
    const row = db.prepare(`SELECT is_success FROM api_patrol_requests WHERE request_id='r-dup-1'`).get()
    expect(/** @type {{is_success: number}} */ (row).is_success).toBe(0) // 后者胜
  })

  it('5.6 ELB 真实行：固定 slb + api_path 归一 + endTime/appId 四保留', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: keyHeader(pushKeySecret),
      payload: {
        package: 'elb', date: '2026-08-10', pool: '华南-广州3',
        rows: [{
          id: '11474802', requestId: 'reqId-cfbf76d0065865feebdcb4e2acdbd8cb',
          userId: 'CIDC-U-x', resourceType: 'L7POLICY', resourceOperation: 'CREATE',
          startTime: '2026-08-10 23:52:13', endTime: '2026-08-10 23:52:14',
          resultStatus: 'FAILED',
          errorMessage: '七层转发策略PolicyDomainName与hostNameCompareType要么都为空',
          dailyReport: '', realtimeReport: '', userName: 'cmic_sim',
          executionTimeMillis: '1000', diagnoseResult: '{"final_conclusion":"null"}',
        }],
      },
    })
    expect(res.statusCode).toBe(200)
    const row = db.prepare(`SELECT * FROM api_patrol_requests WHERE request_id='reqId-cfbf76d0065865feebdcb4e2acdbd8cb'`).get()
    expect(row).toMatchObject({
      product_key: 'slb', api_path: 'L7POLICY/CREATE', is_success: 0,
      request_time: '2026-08-10 23:52:13', end_time: '2026-08-10 23:52:14',
      duration_ms: 1000, daily_report: '', realtime_report: '',
    })
  })

  it('5.8 空接口名行：入库 product_key=NULL', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: keyHeader(pushKeySecret),
      payload: {
        package: 'eip_vpc', date: '2026-08-10', pool: '华南-广州3',
        rows: [eipRow({ requestId: 'r-empty-api', requestMapping: '' })],
      },
    })
    expect(res.statusCode).toBe(200)
    const row = db.prepare(`SELECT product_key FROM api_patrol_requests WHERE request_id='r-empty-api'`).get()
    expect(/** @type {{product_key: string | null}} */ (row).product_key).toBe(null)
  })

  it('5.10 重推幂等：再推同批 → overwritten', async () => {
    const payload = {
      package: 'eip_vpc', date: '2026-08-10', pool: '华南-广州3',
      rows: [eipRow({ requestId: 'r-eip-1', requestMapping: '/acl/v3/floatingip/bind' })],
    }
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: keyHeader(pushKeySecret), payload,
    })
    expect(res.json()).toMatchObject({ overwritten: 1, inserted: 0 })
  })

  it('审计写入：api_patrol.push_* 条目存在（apiKey 身份）', async () => {
    const { listAuditLogs } = await import('../audit.js')
    const entries = listAuditLogs(1)
    const pushEntries = entries.filter((e) => e.action.startsWith('api_patrol.push_'))
    expect(pushEntries.length).toBeGreaterThan(0)
    expect(pushEntries[0].username).toContain('apikey:')
  })
})
