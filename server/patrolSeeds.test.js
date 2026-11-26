import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * API 巡检种子 migration 守卫测试（M1.2，docs/DESIGN-API巡检.md §2.5/§5/§6）。
 * 验收：空库灌入 32+17、幂等（标记跳过）、推断项标注、顺序对拍。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-seeds-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-seeds'

let sqliteAvailable = false
try {
  const { closeDb, getDb } = await import('./db.js')
  closeDb()
  getDb()
  closeDb()
  sqliteAvailable = true
} catch {
  sqliteAvailable = false
}

describe.skipIf(!sqliteAvailable)('api patrol seeds migration', () => {
  /** @type {import('better-sqlite3').Database} */
  let db

  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
    db = getDb()
  })

  afterAll(async () => {
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const readRegistry = () => {
    const row = db.prepare(`SELECT value FROM meta WHERE key='api_patrol_api_registry_v1'`).get()
    return JSON.parse(/** @type {{value: string}} */ (row).value)
  }
  const readRules = () => {
    const row = db.prepare(`SELECT value FROM meta WHERE key='api_patrol_root_cause_rules_v1'`).get()
    return JSON.parse(/** @type {{value: string}} */ (row).value)
  }

  it('2.1 空库灌入：注册表 32 项逐项对拍种子常量', async () => {
    const { migrateApiPatrolSeeds } = await import('./patrolMigration.js')
    migrateApiPatrolSeeds(db)
    const { API_PATROL_API_REGISTRY_SEED } = await import('./patrolSeeds.js')
    const registry = readRegistry()
    expect(registry.items).toHaveLength(34)
    // 逐项对拍（顺序无关，键值相关）
    const norm = (x) => `${x.productKey}|${x.apiPath}|${x.metricName}|${x.bizType}`
    const expectSet = new Set(API_PATROL_API_REGISTRY_SEED.map(norm))
    for (const item of registry.items) {
      expect(expectSet.has(norm(item))).toBe(true)
    }
    // 抽查关键项
    const eipShared = registry.items.find((i) => i.apiPath === '/customer/v3/sharedBandwidth/addExistFip')
    expect(eipShared).toMatchObject({ productKey: 'eip', metricName: '移入共享带宽', bizType: '更新' })
    const havipDel = registry.items.find((i) => i.apiPath === '/acl/v3/havip/{havipId}')
    expect(havipDel).toMatchObject({ productKey: 'vpc', metricName: '删除HA VIP' })
  })

  it('2.2 推断项 inferred=true 标注（C2 三项）', () => {
    const registry = readRegistry()
    const inferred = registry.items.filter((i) => i.inferred === true)
    expect(inferred.map((i) => i.apiPath).sort()).toEqual(['LB/UNSUBSCRIBE', 'LISTENER/CREATE', 'LISTENER/DELETE'])
  })

  it('2.3 根因规则有序灌入（11-18 v2：+order 0 RAM 鉴权最优先 + 18~22 补强；11-26 +order 3.5），兜底末位', () => {
    const rules = readRules()
    // 种子 26 条：order 0（RAM/权限）+ 1~17 + 1.5（11-25 网段与路由冲突）+ 3.5（11-26 失败原因未落日志）
    // + 18~22（11-17 补强）+ 99 兜底
    expect(rules.items).toHaveLength(26)
    // 11-18：强语义（鉴权）全局最优先——#288 劫持先例（被 order 11 HAVIP 接口名泛匹配抢先）
    expect(rules.items[0]).toMatchObject({ order: 0, l1: '权限&授权不足', l2: 'RAM/子账号鉴权拒绝' })
    expect(rules.items[1]).toMatchObject({ l1: '业务冲突', l2: 'DNAT规则冲突', productAction: '待处理' })
    // 11-26 拆类拍板：规则 3/13 从缺口挪「产品可观测性不足」+ 新增 3.5 失败原因未落日志（待处理）
    expect(rules.items.find((r) => r.order === 3)).toMatchObject({ l1: '产品可观测性不足', productAction: '待处理' })
    expect(rules.items.find((r) => r.order === 3.5)).toMatchObject({ l1: '产品可观测性不足', l2: '失败原因未落日志', productAction: '待处理' })
    expect(rules.items.find((r) => r.order === 13)).toMatchObject({ l1: '产品可观测性不足', productAction: '待处理' })
    expect(rules.items.find((r) => r.order === 2)).toMatchObject({ l1: '诊断能力缺口', productAction: '—' })   // 查无数据仍归缺口
    const fallback = rules.items[rules.items.length - 1]
    expect(fallback).toMatchObject({ l1: '其他&未归类', l2: '兜底', isFallback: true, productAction: '待处理' })
    // 顺序连续性（order 升序；order 99 兜底恒尾）
    const orders = rules.items.map((r) => r.order)
    expect(orders).toEqual([0, 1, 1.5, 2, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 99])
  })

  it('2.4 锁定二分：规则6 并发进行中=—、规则7 机制待查=待处理', () => {
    const rules = readRules()
    const r6 = rules.items.find((r) => r.order === 6)
    const r7 = rules.items.find((r) => r.order === 7)
    expect(r6).toMatchObject({ l2: '并发进行中', productAction: '—' })
    expect(r7).toMatchObject({ l2: '锁定机制待查', productAction: '待处理' })
  })

  it('2.5 幂等：重复执行不重灌不覆盖（v1 标记跳过 + 11-18 v2 按 order 判重）', async () => {
    const { migrateApiPatrolSeeds } = await import('./patrolMigration.js')
    // 手工改一条，重跑 migration，断言不被覆盖（标记存在即跳过）
    const registry = readRegistry()
    registry.items.push({ productKey: 'eip', metricName: '手工项', apiPath: '/manual/x', bizType: 'x' })
    db.prepare(`UPDATE meta SET value=? WHERE key='api_patrol_api_registry_v1'`).run(JSON.stringify(registry))
    // 手工改规则表（模拟运营编辑：改一条 + 删一条种子），重跑 migration
    const rules = readRules()
    rules.items.find((r) => r.order === 6).enabled = false
    const withoutOrder9 = rules.items.filter((r) => r.order !== 9)
    db.prepare(`UPDATE meta SET value=? WHERE key='api_patrol_root_cause_rules_v1'`).run(JSON.stringify({ ...rules, items: withoutOrder9 }))
    migrateApiPatrolSeeds(db)
    expect(readRegistry().items).toHaveLength(35) // 手工项保留
    const rulesAfter = readRules().items
    // v2 幂等：v2 标记已打（beforeAll 首跑）——重跑不追加不覆盖：运营删的 order 9 不复活（尊重运营编辑）；
    // v4（11-25）裸跑追加 order 1.5；v5（11-26）裸跑追加 order 3.5——23 基础 +2
    expect(rulesAfter).toHaveLength(25)
    expect(rulesAfter.some((r) => r.order === 9)).toBe(false)
    expect(rulesAfter.some((r) => r.order === 1.5)).toBe(true) // v4 追加新种子规则
    expect(rulesAfter.some((r) => r.order === 3.5)).toBe(true) // v5 追加（拆类）
    expect(rulesAfter.find((r) => r.order === 6).enabled).toBe(false) // 运营编辑保留
    // migration 标记存在
    const flag = db.prepare(`SELECT value FROM meta WHERE key='migrate_api_patrol_seeds_v1'`).get()
    expect(flag).toBeTruthy()
    const flag2 = db.prepare(`SELECT value FROM meta WHERE key='migrate_api_patrol_seeds_v2'`).get()
    expect(flag2).toBeTruthy()
  })
})
