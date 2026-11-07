import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * API 巡检数据层守卫测试（M1.1/M1.2，docs/DESIGN-API巡检.md §2）。
 * 验收：表结构逐列对拍设计、唯一键约束生效、种子 migration 幂等。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-db-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-db'

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

describe.skipIf(!sqliteAvailable)('api patrol schema', () => {
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

  const tableColumns = (table) =>
    db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name)

  it('1.1 api_patrol_stats 列结构逐列对拍设计 §2.1', () => {
    expect(tableColumns('api_patrol_stats')).toEqual([
      'id', 'stat_date', 'product_key', 'pool_name', 'metric_name', 'api_path',
      'biz_type', 'success_rate', 'duration_normal_ratio', 'avg_duration',
      'created_at', 'updated_at',
    ])
  })

  it('1.2 api_patrol_requests 列结构逐列对拍设计 §2.2（18 列归一）', () => {
    expect(tableColumns('api_patrol_requests')).toEqual([
      'id', 'external_row_id', 'request_date', 'pool_name', 'product_key',
      'request_id', 'api_path', 'user_id', 'user_name', 'is_success',
      'duration_ms', 'request_time', 'end_time', 'biz_category', 'biz_target',
      'biz_no', 'error_message', 'pushed_diagnose', 'app_id', 'daily_report',
      'realtime_report', 'created_at',
    ])
  })

  it('1.3 api_patrol_failure_groups 列结构逐列对拍设计 §2.3', () => {
    expect(tableColumns('api_patrol_failure_groups')).toEqual([
      'id', 'group_date', 'product_key', 'pool_name', 'api_path', 'metric_name',
      'user_name', 'first_request_id', 'first_request_time', 'pre_compress_count',
      'suppressed_request_ids', 'customer_type', 'root_cause_l1', 'root_cause_l2',
      'product_action_status', 'assignee', 'root_cause_confirmed', 'measure_feedback',
      'feedback_by', 'feedback_at', 'created_at', 'updated_at',
    ])
  })

  it('1.4 api_patrol_diagnoses 列结构逐列对拍设计 §2.4', () => {
    expect(tableColumns('api_patrol_diagnoses')).toEqual([
      'id', 'failure_group_id', 'request_id', 'status', 'tool_name',
      'mcp_raw_response', 'final_conclusion', 'root_cause_l1', 'root_cause_l2',
      'diagnosed_at',
    ])
  })

  it('1.5 关键 DEFAULT：pending_diagnosis / suppressed=[]', () => {
    const groups = db.prepare(`PRAGMA table_info(api_patrol_failure_groups)`).all()
    const status = /** @type {{name: string, dflt_value: string}[]} */ (groups).find(
      (c) => c.name === 'product_action_status',
    )
    expect(status?.dflt_value).toContain('pending_diagnosis')
    const suppressed = /** @type {{name: string, dflt_value: string}[]} */ (groups).find(
      (c) => c.name === 'suppressed_request_ids',
    )
    expect(suppressed?.dflt_value).toContain('[]')
  })

  it('1.6 requests.product_key 可空（空接口名行归属无从判定，A 项修正）', () => {
    const cols = /** @type {{name: string, notnull: number}[]} */ (
      db.prepare(`PRAGMA table_info(api_patrol_requests)`).all()
    )
    const pk = cols.find((c) => c.name === 'product_key')
    expect(pk?.notnull).toBe(0)
  })

  it('1.7 stats 唯一键含 metric_name（同接口多指标不吞数据）', () => {
    const insert = db.prepare(`
      INSERT INTO api_patrol_stats
        (stat_date, product_key, pool_name, api_path, metric_name, biz_type, success_rate,
         duration_normal_ratio, avg_duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    const base = ['2026-08-10', 'eip', '华南-广州3', '/acl/v3/floatingip/bind', '绑定', '绑定', 96.72, null, null, '2026-11-07T00:00:00Z', '2026-11-07T00:00:00Z']
    insert.run(...base)
    // 同键同指标重插 → 覆盖（OR REPLACE 语义由业务层 upsert 使用；此处断言 UNIQUE 约束存在）
    expect(() => {
      db.prepare(`INSERT INTO api_patrol_stats
        (stat_date, product_key, pool_name, api_path, metric_name, biz_type, success_rate,
         duration_normal_ratio, avg_duration, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(...base)
    }).toThrow()
    // 同接口不同指标名 → 两行并存（metric_name 入键）
    insert.run('2026-08-10', 'eip', '华南-广州3', '/acl/v3/floatingip/bind', '绑定云主机', '绑定', 96.72, null, null, 't', 't')
    const count = db
      .prepare(`SELECT COUNT(*) AS n FROM api_patrol_stats WHERE stat_date=? AND product_key=? AND pool_name=? AND api_path=?`)
      .get('2026-08-10', 'eip', '华南-广州3', '/acl/v3/floatingip/bind')
    expect(count?.n).toBe(2)
  })

  it('1.8 requests 唯一键 (request_date, pool_name, request_id)', () => {
    const insert = db.prepare(`
      INSERT INTO api_patrol_requests
        (request_date, pool_name, request_id, api_path, user_id, user_name, is_success,
         request_time, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    insert.run('2026-08-10', '华南-广州3', 'reqId-X', '/a', 'u1', 'n1', 0, '2026-08-10 10:00:00', 't')
    expect(() => {
      insert.run('2026-08-10', '华南-广州3', 'reqId-X', '/a', 'u1', 'n1', 1, '2026-08-10 10:00:01', 't')
    }).toThrow()
    // 不同池同 requestId 可并存（跨池防御不误伤）
    insert.run('2026-08-10', '华东-济南', 'reqId-X', '/a', 'u1', 'n1', 0, '2026-08-10 10:00:00', 't')
  })

  it('1.9 索引存在对拍（含 groups (group_date, product_key, root_cause_l1)）', () => {
    const idx = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='api_patrol_failure_groups'`)
      .all()
      .map((r) => /** @type {{name: string}} */ (r).name)
    expect(idx).toContain('idx_patrol_groups_cause_stats')
    const idxReq = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='index' AND tbl_name='api_patrol_requests'`)
      .all()
      .map((r) => /** @type {{name: string}} */ (r).name)
    expect(idxReq).toContain('idx_patrol_requests_scope')
    expect(idxReq).toContain('idx_patrol_requests_compress')
  })

  it('1.10 旧库兼容：重复 initBusinessSchema 不报错', async () => {
    const { initBusinessSchema } = await import('./businessDb.js')
    expect(() => initBusinessSchema()).not.toThrow()
  })
})
