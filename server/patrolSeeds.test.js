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

  it('2.3 根因规则 17+兜底 有序灌入，DNAT 序1、兜底末位', () => {
    const rules = readRules()
    expect(rules.items).toHaveLength(18)
    expect(rules.items[0]).toMatchObject({ l1: '业务冲突', l2: 'DNAT规则冲突', productAction: '待处理' })
    const fallback = rules.items[rules.items.length - 1]
    expect(fallback).toMatchObject({ l1: '其他/未归类', l2: '兜底', isFallback: true, productAction: '待处理' })
    // 顺序连续性
    const orders = rules.items.filter((r) => !r.isFallback).map((r) => r.order)
    expect(orders).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17])
  })

  it('2.4 锁定二分：规则6 并发进行中=—、规则7 机制待查=待处理', () => {
    const rules = readRules()
    const r6 = rules.items.find((r) => r.order === 6)
    const r7 = rules.items.find((r) => r.order === 7)
    expect(r6).toMatchObject({ l2: '并发进行中', productAction: '—' })
    expect(r7).toMatchObject({ l2: '锁定机制待查', productAction: '待处理' })
  })

  it('2.5 幂等：重复执行不重灌不覆盖（标记跳过）', async () => {
    const { migrateApiPatrolSeeds } = await import('./patrolMigration.js')
    // 手工改一条，重跑 migration，断言不被覆盖（标记存在即跳过）
    const registry = readRegistry()
    registry.items.push({ productKey: 'eip', metricName: '手工项', apiPath: '/manual/x', bizType: 'x' })
    db.prepare(`UPDATE meta SET value=? WHERE key='api_patrol_api_registry_v1'`).run(JSON.stringify(registry))
    migrateApiPatrolSeeds(db)
    expect(readRegistry().items).toHaveLength(35) // 手工项保留
    expect(readRules().items).toHaveLength(18)
    // migration 标记存在
    const flag = db.prepare(`SELECT value FROM meta WHERE key='migrate_api_patrol_seeds_v1'`).get()
    expect(flag).toBeTruthy()
  })
})
