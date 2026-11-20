import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'

process.env.JWT_SECRET = 'test-jwt-secret-for-diagnosis-gaps-x'

/**
 * 诊断能力需求池端点守卫（11-19 拍板：缺口组汇集为 MCP 日志服务诊断能力建设的需求输入）。
 * 端点：GET /api/patrol/diagnosis-gaps/summary
 * 契约：
 *  1. 缺口判定 = COALESCE 有效根因口径——人工修正为具体根因的组自动退出需求池
 *  2. 池接入分类从 MCP 响应推断（classifyGapKind）：pool_uncovered 分区一 /
 *     log_not_collected+failure_log_missing 分区二；不维护池清单
 *  3. 聚合行带 requestIds（保序去重，复制交付用）+ jira 占位字段
 */

const sqliteAvailable = (() => {
  try { require.resolve('better-sqlite3'); return true } catch { return false }
})()

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'patrol-diag-gaps-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir

const describeGaps = sqliteAvailable ? describe : describe.skip

const dbModule = await import('../db.js')
const require_getDb = () => dbModule.getDb()

/** @type {import('fastify').FastifyInstance} */
let app
let token = ''

// MCP 响应素材（seed 用）
const RAW_OK_EMPTY = JSON.stringify({ code: '0000', data: { records: [], total: 0 } })
const RAW_OK_INFO = JSON.stringify({ code: '0000', data: { records: [{ content: '[2026-09-01 10:00:00] [ INFO] [1] RequestIdHeaderFilter ok' }] } })
const RAW_ERR = JSON.stringify({ code: '5000', msg: 'pool not supported' })

describeGaps('patrol diagnosis-gaps 需求池端点', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({
      username: 'diag_gaps_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin',
    })
    token = signAccessToken(admin)

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolQueryRoutes } = await import('./patrolQuery.js')
    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerAuthHooks(app)
    registerPatrolQueryRoutes(app)
    await app.ready()

    seedGaps()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const authHeader = () => ({ authorization: `Bearer ${token}` })

  it('classifyGapKind 纯函数：五形态判别（11-20 修复：undiagnosed 类 + 日志行迹象细分）', async () => {
    const { classifyGapKind } = await import('./patrolQuery.js')
    // 无诊断记录=从未诊断（超龄收敛态）——不再兜底进 pool_uncovered（11-20 拍板不进需求池）
    expect(classifyGapKind(null, false)).toBe('undiagnosed')
    expect(classifyGapKind('anything', false)).toBe('undiagnosed')
    // 有诊断记录无响应=调用层失败 → 池未接入
    expect(classifyGapKind(null, true)).toBe('pool_uncovered')
    expect(classifyGapKind('', true)).toBe('pool_uncovered')
    // 非 JSON 旧文本形态：有日志行迹象=MCP 通（查不到失败日志）；无迹象=错误页未接入
    expect(classifyGapKind('[2026-09-01 10:00:00] [ INFO] RequestIdFilter ok', true)).toBe('log_not_collected')
    expect(classifyGapKind('plain error page without log lines', true)).toBe('pool_uncovered')
    expect(classifyGapKind(RAW_ERR, true)).toBe('pool_uncovered')         // MCP 业务码非 0000
    expect(classifyGapKind(RAW_OK_EMPTY, true)).toBe('log_not_collected') // 0000+records=0
    expect(classifyGapKind(RAW_OK_INFO, true)).toBe('failure_log_missing') // 0000+INFO only
    const rawWithErr = JSON.stringify({ code: '0000', data: { records: [{ content: '[ERROR] boom' }] } })
    expect(classifyGapKind(rawWithErr, true)).toBe('other')                // 防御位：有失败语义不该判缺口
  })

  it('summary 聚合（11-20 09:44 拍板：无时间窗口显示全部）：分区二接口聚合 + 分区一池汇总 + stats', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    // 分区二：2 个聚合键（eip|I1|P1 与 eip|I1|P2——C 组异池）
    expect(data.rows).toHaveLength(2)
    const main = data.rows.find((r) => r.poolName === 'P1')
    expect(main).toBeTruthy()
    expect(main.productName).toBeTruthy()
    expect(main.groupCount).toBe(2)                       // A+B（E 已 manual 逃逸、D 未接入分区一）
    expect(main.preCompressTotal).toBe(4)                 // A(1)+B(3)
    expect(main.gapKinds).toEqual({ log_not_collected: 1, failure_log_missing: 1 })
    // requestIds：A.first → B.first → B.suppressed（与 first 重复的去重，保序）
    expect(main.requestIds).toEqual(['gap-a-first', 'gap-b-first', 'gap-a-sup-1', 'gap-a-sup-2'])
    expect(main.jiraTicketId).toBeNull()                 // Jira 扩展占位
    // 分区一：P9 只含 U 组（MCP 错误响应）——D 组无诊断记录，11-20 修复后归 undiagnosed 不进未接入分区
    expect(data.uncoveredPools).toHaveLength(1)
    expect(data.uncoveredPools[0].poolName).toBe('P9')
    expect(data.uncoveredPools[0].groupCount).toBe(1)
    // 未诊断清单（池维度汇总——复制交付补诊断）：D 组在列
    expect(data.undiagnosedGroups).toHaveLength(1)
    expect(data.undiagnosedGroups[0].poolName).toBe('P9')
    expect(data.undiagnosedGroups[0].groupCount).toBe(1)
    expect(data.undiagnosedGroups[0].requestIds).toEqual(['gap-d-first'])
    // stats：A+B+C+U = 4 需求池组 + D=1 未诊断（E 逃逸 F 无关 G 未诊断不计）
    expect(data.stats.groupCount).toBe(5)
    expect(data.stats.coveredCount).toBe(3)
    expect(data.stats.uncoveredCount).toBe(1)
    expect(data.stats.undiagnosedCount).toBe(1)
    expect(data.stats.poolCount).toBe(3)                  // P1/P2/P9
  })

  it('manual 逃逸：人工修正为具体根因的组不进任何分区', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary',
      headers: authHeader(),
    })
    const data = res.json()
    const allRequestIds = [
      ...data.rows.flatMap((r) => r.requestIds),
      ...data.uncoveredPools.flatMap((r) => r.requestIds),
      ...data.undiagnosedGroups.flatMap((r) => r.requestIds),
    ]
    expect(allRequestIds).not.toContain('gap-e-first')    // E 组逃逸（manual=业务冲突）
  })

  it('groups 联动：rootCauseL1=诊断能力缺口 过滤出 5 组（E 逃逸/F 无关/G 未诊断排除）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/patrol/failures/groups?startDate=2026-09-01&endDate=2026-09-02&rootCauseL1=' + encodeURIComponent('诊断能力缺口'),
      headers: authHeader(),
    })
    expect(res.json().rows).toHaveLength(5)
    expect(res.json().rows.some((r) => r.firstRequestId === 'gap-e-first')).toBe(false)
  })

  it('全量口径守卫（11-20 拍板）：任意日期参数被忽略——仍返回全部缺口组（防窗口回潮）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary?startDate=2026-01-01&endDate=2026-01-02',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    // 传窄窗口参数也不缩小——种子全部 5 缺口组都在（窗口语义已删除）
    expect(data.stats.groupCount).toBe(5)
    expect(data.rows).toHaveLength(2)
  })
})

/** seed：A/B 同键双形态 / C 异池 / U MCP错误 / D 无诊断记录 / E manual逃逸 / F 无关 / G 未诊断 */
function seedGaps() {
  const db = require_getDb()
  const insertGroup = db.prepare(`
    INSERT INTO api_patrol_failure_groups
      (group_date, product_key, pool_name, api_path, metric_name, user_name,
       first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
       customer_type, root_cause_l1, root_cause_l2, product_action_status,
       root_cause_l1_manual, created_at, updated_at)
    VALUES (?, 'eip', ?, ?, '绑定', ?, ?, ?, ?, ?, '', ?, ?, '—', ?, 't', 't')
  `)
  // A：日志未采集（records=0），pre=1 无 suppressed
  insertGroup.run('2026-09-01', 'P1', 'I1', 'userA', 'gap-a-first', '2026-09-01 10:00:00', 1, '[]', '诊断能力缺口', null, null)
  // B：失败日志缺失（INFO only），pre=3 = first + 2 suppressed（其中 1 个与 first 重复——测去重）
  insertGroup.run('2026-09-01', 'P1', 'I1', 'userB', 'gap-b-first', '2026-09-01 11:00:00', 3, '["gap-b-first","gap-a-sup-1","gap-a-sup-2"]', '诊断能力缺口', null, null)
  // C：异池（2026-09-02）
  insertGroup.run('2026-09-02', 'P2', 'I1', 'userC', 'gap-c-first', '2026-09-02 10:00:00', 1, '[]', '诊断能力缺口', null, null)
  // U：MCP 错误响应（池 P9 未接入）
  insertGroup.run('2026-09-01', 'P9', 'I9', 'userU', 'gap-u-first', '2026-09-01 12:00:00', 1, '[]', '诊断能力缺口', null, null)
  // D：无诊断记录（fetch 失败形态）池 P9
  insertGroup.run('2026-09-01', 'P9', 'I9', 'userD', 'gap-d-first', '2026-09-01 13:00:00', 1, '[]', '诊断能力缺口', null, null)
  // E：manual 逃逸（原始缺口 + 人工修正业务冲突）
  insertGroup.run('2026-09-01', 'P1', 'I1', 'userE', 'gap-e-first', '2026-09-01 14:00:00', 1, '[]', '诊断能力缺口', null, '业务冲突')
  // F：无关组（业务冲突）
  insertGroup.run('2026-09-01', 'P1', 'IF', 'userF', 'gap-f-first', '2026-09-01 15:00:00', 1, '[]', '业务冲突', null, null)
  // G：未诊断
  insertGroup.run('2026-09-01', 'P1', 'IG', 'userG', 'gap-g-first', '2026-09-01 16:00:00', 1, '[]', null, null, null)

  const insertDiag = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, root_cause_source, diagnosed_at)
    VALUES (?, ?, 'success', 'log_search', ?, NULL, '诊断能力缺口', NULL, NULL, 't')
  `)
  const byFirst = db.prepare('SELECT id FROM api_patrol_failure_groups WHERE first_request_id=?')
  for (const [firstId, raw] of [
    ['gap-a-first', RAW_OK_EMPTY],
    ['gap-b-first', RAW_OK_INFO],
    ['gap-c-first', RAW_OK_EMPTY],
    ['gap-u-first', RAW_ERR],
    // gap-d-first 无诊断记录（D 组兜底 pool_uncovered）
    ['gap-e-first', RAW_OK_EMPTY],
  ]) {
    const g = byFirst.get(firstId)
    insertDiag.run(g.id, firstId, raw)
  }
}
