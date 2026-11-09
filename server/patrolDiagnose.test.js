import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * MCP Client + 诊断任务测试（M4，docs/DESIGN-API巡检.md §4.2）。
 * mock MCP 服务（本地 http）返回样例真实诊断 JSON——走真实解析链（mcp_raw_response 输入，
 * 批判修正 ②：不绕过 extractDiagnosticText）。
 * 验收：JSON-RPC 形态/解析回填/LB 状态文本→待处理/超时 failed/并发=3/诊断失败组保持 pending_diagnosis。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-diag-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-diag-xx'

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

const SAMPLE_DIAG_LOG_MISSING = JSON.stringify({
  request_overview: { request_id: 'reqId-x' },
  final_conclusion: '日志查询异常/无数据-根据当前条件以 ERROR/WARN 关键词未检索到日志，建议人工复查。',
})
const SAMPLE_DIAG_LB_UPDATING = JSON.stringify({
  final_conclusion: '请求失败的根本原因是目标负载均衡器当前处于“正在更新中或状态不正常”的状态，导致创建L7策略的前置条件检查失败。',
})

describe.skipIf(!sqliteAvailable)('patrol diagnose (MCP client + task)', () => {
  /** @type {import('better-sqlite3').Database} */
  let db
  /** @type {import('node:http').Server} */
  let mcpServer
  let mcpPort = 0
  /** @type {Array<Record<string, unknown>>} */
  const receivedBodies = []

  beforeAll(async () => {
    const { closeDb, getDb } = await import('./db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('./businessDb.js')
    initBusinessSchema()
    db = getDb()

    // mock MCP 服务（JSON-RPC over HTTP）
    mcpServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        try { receivedBodies.push(JSON.parse(body)) } catch { /* ignore */ }
        /** @type {Record<string, unknown>} */
        let parsed
        try { parsed = JSON.parse(body) } catch { parsed = {} }
        const method = String(parsed.method || '')
        if (method === 'tools/call') {
          const args = /** @type {{ arguments?: { filter?: string, requestId?: string } }} */ (parsed.params || {})
          const rid = String(args.arguments?.filter || args.arguments?.requestId || '')
          let result
          if (rid.startsWith('lb-updating')) result = SAMPLE_DIAG_LB_UPDATING
          else if (rid.startsWith('timeout')) {
            // 模拟超时：延迟 3s（客户端超时 500ms）
            setTimeout(() => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: { content: [{ type: 'text', text: SAMPLE_DIAG_LOG_MISSING }] } })) }, 3000)
            return
          }
          else result = SAMPLE_DIAG_LOG_MISSING
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({
            jsonrpc: '2.0', id: parsed.id,
            result: { content: [{ type: 'text', text: result }] },
          }))
          return
        }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ jsonrpc: '2.0', id: parsed.id, result: {} }))
      })
    })
    await new Promise((resolve) => { mcpServer.listen(0, '127.0.0.1', () => { resolve(null) }) })
    mcpPort = /** @type {import('net').AddressInfo} */ (/** @type {unknown} */ (mcpServer.address())).port
  })

  afterAll(async () => {
    await new Promise((resolve) => { mcpServer.close(() => resolve(null)) })
    const { closeDb } = await import('./db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('8.1 JSON-RPC 形态对拍：method=tools/call、name=log_search、arguments 含 filter/时间窗/枚举（真实契约）', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    const { runPatrolDiagnose } = await import('./patrolDiagnose.js')
    db.prepare(`INSERT INTO api_patrol_requests
      (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
      VALUES ('2026-09-01', 'p1', 'eip', 'diag-1', '/acl/v3/floatingip/bind', 'u1', 'userA', 0, '2026-09-01 10:00:00', 't')`).run()
    compressPatrolDay('2026-09-01', 'p1')
    await runPatrolDiagnose({
      date: '2026-09-01', pool: 'p1',
      mcpEndpoint: `http://127.0.0.1:${mcpPort}/mcp`,
      mcpToken: 'test-token', timeoutMs: 2000, concurrency: 3,
    })
    expect(receivedBodies.length).toBeGreaterThan(0)
    const call = receivedBodies.find((b) => b.method === 'tools/call')
    expect(call).toBeTruthy()
    expect(/** @type {{params: {name: string}}} */ (call).params.name).toBe('log_search')
    const args = /** @type {{params: {arguments: Record<string, string>}}} */ (call).params.arguments
    expect(args.filter).toBe('diag-1')
    expect(args.productName).toBe('fip/vpc')
    expect(args.poolName).toBe('p1')
    expect(String(args.startTime)).toMatch(/^2026-09-01 \d{2}:\d{2}:\d{2}$/)
    expect(String(args.endTime)).toMatch(/^2026-09-01 \d{2}:\d{2}:\d{2}$/)
  })

  it('8.2 解析回填：日志缺失文本 → groups L1=诊断能力缺口、状态=—；diagnoses success', async () => {
    const group = db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE first_request_id='diag-1'`).get()
    expect(group).toBeTruthy()
    const g = /** @type {{root_cause_l1: string, root_cause_l2: string, product_action_status: string}} */ (group)
    expect(g.root_cause_l1).toBe('诊断能力缺口')
    expect(g.root_cause_l2).toBe('日志缺失/无数据')
    expect(g.product_action_status).toBe('—')
    const diag = db.prepare(`SELECT * FROM api_patrol_diagnoses WHERE request_id='diag-1'`).get()
    expect(/** @type {{status: string}} */ (diag).status).toBe('success')
    expect(String(/** @type {{final_conclusion: string}} */ (diag).final_conclusion)).toContain('日志查询异常')
  })

  it('8.3 LB 状态文本 → L1=资源状态异常、状态=待处理', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    const { runPatrolDiagnose } = await import('./patrolDiagnose.js')
    db.prepare(`INSERT INTO api_patrol_requests
      (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
      VALUES ('2026-09-02', 'p1', 'slb', 'lb-updating-1', 'L7POLICY/CREATE', 'u2', 'userB', 0, '2026-09-02 10:00:00', 't')`).run()
    compressPatrolDay('2026-09-02', 'p1')
    await runPatrolDiagnose({
      date: '2026-09-02', pool: 'p1',
      mcpEndpoint: `http://127.0.0.1:${mcpPort}/mcp`,
      mcpToken: 't', timeoutMs: 2000, concurrency: 3,
    })
    const group = /** @type {{root_cause_l1: string, product_action_status: string}} */ (
      db.prepare(`SELECT * FROM api_patrol_failure_groups WHERE first_request_id='lb-updating-1'`).get()
    )
    expect(group.root_cause_l1).toBe('资源状态异常')
    expect(group.product_action_status).toBe('待处理')
  })

  it('8.4 超时 → diagnoses.status=failed、组保持 pending_diagnosis 可重试', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    const { runPatrolDiagnose } = await import('./patrolDiagnose.js')
    db.prepare(`INSERT INTO api_patrol_requests
      (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
      VALUES ('2026-09-03', 'p1', 'eip', 'timeout-1', '/acl/v3/floatingip/bind', 'u3', 'userC', 0, '2026-09-03 10:00:00', 't')`).run()
    compressPatrolDay('2026-09-03', 'p1')
    await runPatrolDiagnose({
      date: '2026-09-03', pool: 'p1',
      mcpEndpoint: `http://127.0.0.1:${mcpPort}/mcp`,
      mcpToken: 't', timeoutMs: 500, concurrency: 3,
    })
    const diag = db.prepare(`SELECT status FROM api_patrol_diagnoses WHERE request_id='timeout-1'`).get()
    expect(/** @type {{status: string}} */ (diag).status).toBe('failed')
    const group = db.prepare(`SELECT product_action_status FROM api_patrol_failure_groups WHERE first_request_id='timeout-1'`).get()
    expect(/** @type {{product_action_status: string}} */ (group).product_action_status).toBe('pending_diagnosis')
  })

  it('8.5 并发=3：5 组同时诊断 → 运行中≤3（队列）', async () => {
    const { compressPatrolDay } = await import('./patrolCompress.js')
    const { runPatrolDiagnose } = await import('./patrolDiagnose.js')
    // 5 个不同客户各 1 笔失败（同客户同接口相邻会链式并组——并发测的是组数）
    for (let i = 0; i < 5; i++) {
      db.prepare(`
        INSERT INTO api_patrol_requests
          (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
        VALUES ('2026-09-04', 'p1', 'eip', ?, '/acl/v3/floatingip/bind', ?, ?, 0, ?, 't')
      `).run(`conc-${i}`, `u4-${i}`, `userD${i}`, `2026-09-04 10:0${i}:00`)
    }
    compressPatrolDay('2026-09-04', 'p1')
    // runPatrolDiagnose 内部并发上限 3：诊断全部完成后 5 组应全部 success
    await runPatrolDiagnose({
      date: '2026-09-04', pool: 'p1',
      mcpEndpoint: `http://127.0.0.1:${mcpPort}/mcp`,
      mcpToken: 't', timeoutMs: 2000, concurrency: 3,
    })
    const n = db.prepare(`SELECT COUNT(*) n FROM api_patrol_diagnoses WHERE request_id LIKE 'conc-%' AND status='success'`).get()
    expect(/** @type {{n: number}} */ (n).n).toBe(5)
  })
})
