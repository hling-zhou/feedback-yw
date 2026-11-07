import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * API 巡检压缩与带回（M3，docs/DESIGN-API巡检.md §4.1/§2.3）。
 * 验收：链式窗口语义（≤1h 含等号/断链/含池/日切）、不变式（Σcount=失败总数、requestId 全集无交叠）、
 * 冻结列、pending_diagnosis 初始、重推带回（唯一带回/歧义告警不带/无旧组全新）、显式触发。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-comp-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-comp-xx'

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

/** 样例实测键：8月7日 广州3 order/delete 197 笔压缩后组数（预计算基准，独立 SQL 复算法在 8.7 用例内） */
const SAMPLE_COMPRESS_BASELINE = { date: '2026-08-07', pool: '华南-广州3', api: '/customer/v3/order/delete', failCount: 197, groups: 2 }

describe.skipIf(!sqliteAvailable)('patrol compress', () => {
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

  const insertRequest = (date, pool, api, requestId, userName, time, success = 0) => {
    db.prepare(`
      INSERT INTO api_patrol_requests
        (request_date, pool_name, product_key, request_id, api_path, user_id, user_name,
         is_success, request_time, created_at)
      VALUES (?, ?, 'eip', ?, ?, ?, ?, ?, ?, 't')
    `).run(date, pool, requestId, api, `uid-${userName}`, userName, success, time)
  }

  const groupsOf = (date, pool, api, user) =>
    db.prepare(`
      SELECT * FROM api_patrol_failure_groups
      WHERE group_date=? AND pool_name=? AND api_path=? AND user_name=?
      ORDER BY first_request_time
    `).all(date, pool, api, user)

  it('6.1 链式窗口：10:00/10:30/11:15 三笔 → 1 组（相邻各≤1h，首尾75min）', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    insertRequest('2026-08-01', 'p1', '/api/x', 'r1', 'userA', '2026-08-01 10:00:00')
    insertRequest('2026-08-01', 'p1', '/api/x', 'r2', 'userA', '2026-08-01 10:30:00')
    insertRequest('2026-08-01', 'p1', '/api/x', 'r3', 'userA', '2026-08-01 11:15:00')
    const result = compressPatrolDay('2026-08-01', 'p1')
    const groups = groupsOf('2026-08-01', 'p1', '/api/x', 'userA')
    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      first_request_id: 'r1', pre_compress_count: 3,
      suppressed_request_ids: JSON.stringify(['r2', 'r3']),
    })
  })

  it('6.2 断链：10:00/11:30 相邻 90min → 2 组各 count=1', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    insertRequest('2026-08-02', 'p1', '/api/y', 'r1', 'userA', '2026-08-02 10:00:00')
    insertRequest('2026-08-02', 'p1', '/api/y', 'r2', 'userA', '2026-08-02 11:30:00')
    await Promise.resolve(compressPatrolDay('2026-08-02', 'p1'))
    const groups = groupsOf('2026-08-02', 'p1', '/api/y', 'userA')
    expect(groups).toHaveLength(2)
    expect(groups.map((g) => /** @type {{pre_compress_count: number}} */ (g).pre_compress_count)).toEqual([1, 1])
    expect(groups.map((g) => /** @type {{first_request_id: string}} */ (g).first_request_id)).toEqual(['r1', 'r2'])
  })

  it('6.3 边界值：相邻恰好 3600s → 并组（≤ 语义含等号）', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    insertRequest('2026-08-03', 'p1', '/api/z', 'r1', 'userA', '2026-08-03 10:00:00')
    insertRequest('2026-08-03', 'p1', '/api/z', 'r2', 'userA', '2026-08-03 11:00:00')
    compressPatrolDay('2026-08-03', 'p1')
    expect(groupsOf('2026-08-03', 'p1', '/api/z', 'userA')).toHaveLength(1)
  })

  it('6.4 含池不串：同客户同接口同分钟不同池 → 2 组', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    insertRequest('2026-08-04', 'poolA', '/api/w', 'r1', 'userA', '2026-08-04 10:00:00')
    insertRequest('2026-08-04', 'poolB', '/api/w', 'r2', 'userA', '2026-08-04 10:00:30')
    compressPatrolDay('2026-08-04', 'poolA')
    compressPatrolDay('2026-08-04', 'poolB')
    expect(groupsOf('2026-08-04', 'poolA', '/api/w', 'userA')).toHaveLength(1)
    expect(groupsOf('2026-08-04', 'poolB', '/api/w', 'userA')).toHaveLength(1)
  })

  it('6.5 跨日切断：23:50 与次日 00:10（20min）→ 2 组', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    insertRequest('2026-08-05', 'p1', '/api/v', 'r1', 'userA', '2026-08-05 23:50:00')
    insertRequest('2026-08-06', 'p1', '/api/v', 'r2', 'userA', '2026-08-06 00:10:00')
    compressPatrolDay('2026-08-05', 'p1')
    compressPatrolDay('2026-08-06', 'p1')
    expect(groupsOf('2026-08-05', 'p1', '/api/v', 'userA')).toHaveLength(1)
    expect(groupsOf('2026-08-06', 'p1', '/api/v', 'userA')).toHaveLength(1)
  })

  it('6.6 冻结列与初始状态：customer_type 派生、metric_name 注册表冻结、pending_diagnosis', async () => {
    const groups = groupsOf('2026-08-01', 'p1', '/api/x', 'userA') // 6.1 数据（/api/x 未登记→metric 无）
    // 未登记接口 metric_name：压缩按注册表找不到 → 空串冻结（不 join 不漂移）
    expect(groups[0]).toMatchObject({
      product_action_status: 'pending_diagnosis',
      customer_type: '', // userA 无 cmic/test 判据 → 无标记（拍板 11-07 终版：弱标签制）
    })
    // 注册表接口：用真实注册表路径建组验证 metric_name 冻结
    insertRequest('2026-08-07', 'p1', '/acl/v3/floatingip/bind', 'rb1', 'userA', '2026-08-07 10:00:00')
    const { compressPatrolDay } = await import('./patrolCompress.js')
    compressPatrolDay('2026-08-07', 'p1')
    const g = groupsOf('2026-08-07', 'p1', '/acl/v3/floatingip/bind', 'userA')
    expect(g[0]).toMatchObject({ metric_name: '绑定', product_key: 'eip' })
  })

  it('6.7 不变式（P3 批判修正）：Σcount=当日该池失败总数；requestId 全集恰属一组无交叠', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    // 构造混合场景：3 客户 × 多时间簇
    insertRequest('2026-08-08', 'pv', '/api/m', 'm1', 'u1', '2026-08-08 09:00:00')
    insertRequest('2026-08-08', 'pv', '/api/m', 'm2', 'u1', '2026-08-08 09:40:00')
    insertRequest('2026-08-08', 'pv', '/api/m', 'm3', 'u2', '2026-08-08 10:00:00')
    insertRequest('2026-08-08', 'pv', '/api/m', 'm4', 'u2', '2026-08-08 15:00:00')
    insertRequest('2026-08-08', 'pv', '/api/m', 'm5', 'u2', '2026-08-08 20:00:00')
    insertRequest('2026-08-08', 'pv', '/api/m', 'm6', 'u3', '2026-08-08 12:00:00', 1) // 成功行不参与
    compressPatrolDay('2026-08-08', 'pv')
    // 不变式 1：Σpre_compress_count = 失败行数（5）
    const sum = db.prepare(`
      SELECT SUM(pre_compress_count) s FROM api_patrol_failure_groups
      WHERE group_date='2026-08-08' AND pool_name='pv' AND api_path='/api/m'
    `).get()
    expect(/** @type {{s: number}} */ (sum).s).toBe(5)
    // 不变式 2：失败 requestId 全集 = 首条∪suppressed，且互不交叠
    const groups = db.prepare(`
      SELECT first_request_id, suppressed_request_ids FROM api_patrol_failure_groups
      WHERE group_date='2026-08-08' AND pool_name='pv' AND api_path='/api/m'
    `).all()
    const all = []
    for (const g of groups) {
      all.push(/** @type {{first_request_id: string}} */ (g).first_request_id)
      for (const r of JSON.parse(/** @type {{suppressed_request_ids: string}} */ (g).suppressed_request_ids)) {
        all.push(r)
      }
    }
    expect(new Set(all).size).toBe(all.length) // 无交叠
    expect(all.sort()).toEqual(['m1', 'm2', 'm3', 'm4', 'm5']) // 全覆盖（m6 成功行不在）
  })

  it('重推重建：新数据覆盖旧组（同键 upsert），旧行 replaced', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    // 6.1 日期重推：新增 r4
    insertRequest('2026-08-01', 'p1', '/api/x', 'r4', 'userA', '2026-08-01 10:45:00')
    compressPatrolDay('2026-08-01', 'p1', { rebuild: true })
    const groups = groupsOf('2026-08-01', 'p1', '/api/x', 'userA')
    expect(groups).toHaveLength(1)
    expect(groups[0].pre_compress_count).toBe(4)
    expect(groups[0].suppressed_request_ids).toBe(JSON.stringify(['r2', 'r4', 'r3']))
  })

  // ── 带回（§4.1 重推带回）──
  it('7.1 唯一匹配带回：旧组人工状态全带（状态/经办人/反馈）', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    // 旧组：2026-08-09 一组，人工已处理
    insertRequest('2026-08-09', 'p1', '/api/cb', 'c1', 'userB', '2026-08-09 10:00:00')
    compressPatrolDay('2026-08-09', 'p1')
    db.prepare(`
      UPDATE api_patrol_failure_groups SET
        product_action_status='已处理', assignee='张三',
        root_cause_confirmed='属实', measure_feedback='已修复 v1.2',
        feedback_by='ops', feedback_at='2026-08-10 09:00:00'
      WHERE group_date='2026-08-09' AND pool_name='p1' AND api_path='/api/cb'
    `).run()
    // 重推同键数据（同组形态）
    const { compressPatrolDay: re } = await import('./patrolCompress.js')
    re('2026-08-09', 'p1', { rebuild: true })
    const g = groupsOf('2026-08-09', 'p1', '/api/cb', 'userB')
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({
      product_action_status: '已处理', assignee: '张三',
      root_cause_confirmed: '属实', measure_feedback: '已修复 v1.2',
      feedback_by: 'ops',
    })
  })

  it('7.2 歧义不带：旧 1 组 → 重推拆 2 组 → 均不带回+审计告警', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    // 旧：一组（两笔相邻）
    insertRequest('2026-08-10', 'p1', '/api/amb', 'a1', 'userC', '2026-08-10 10:00:00')
    insertRequest('2026-08-10', 'p1', '/api/amb', 'a2', 'userC', '2026-08-10 10:30:00')
    compressPatrolDay('2026-08-10', 'p1')
    db.prepare(`
      UPDATE api_patrol_failure_groups SET product_action_status='已处理', assignee='李四'
      WHERE group_date='2026-08-10' AND pool_name='p1' AND api_path='/api/amb'
    `).run()
    // 重推：数据变化使时间断链 → 拆 2 组（人工状态不能确定带回哪个）
    db.prepare(`DELETE FROM api_patrol_requests WHERE request_date='2026-08-10' AND pool_name='p1' AND api_path='/api/amb'`).run()
    insertRequest('2026-08-10', 'p1', '/api/amb', 'b1', 'userC', '2026-08-10 10:00:00')
    insertRequest('2026-08-10', 'p1', '/api/amb', 'b2', 'userC', '2026-08-10 14:00:00')
    compressPatrolDay('2026-08-10', 'p1', { rebuild: true })
    const groups = groupsOf('2026-08-10', 'p1', '/api/amb', 'userC')
    expect(groups).toHaveLength(2)
    for (const g of groups) {
      expect(g.product_action_status).toBe('pending_diagnosis')
      expect(g.assignee).toBe(null)
    }
    // 审计告警条目
    const { listAuditLogs } = await import('./audit.js')
    const warns = listAuditLogs(7).filter(
      (e) => e.action === 'api_patrol.carryback_ambiguous',
    )
    expect(warns.length).toBeGreaterThan(0)
    expect(warns[0].detail.pool).toBe('p1')
  })

  it('7.3 无旧组：全新数据 pending_diagnosis', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    insertRequest('2026-08-11', 'p1', '/api/new', 'n1', 'userD', '2026-08-11 10:00:00')
    compressPatrolDay('2026-08-11', 'p1')
    const g = groupsOf('2026-08-11', 'p1', '/api/new', 'userD')
    expect(g).toHaveLength(1)
    expect(g[0]).toMatchObject({ product_action_status: 'pending_diagnosis', assignee: null })
  })
})
