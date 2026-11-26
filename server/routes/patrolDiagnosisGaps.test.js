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
const RAW_OK_INFO = JSON.stringify({ code: '0000', data: { records: [{ content: '[2026-11-10 10:00:00] [ INFO] [1] RequestIdHeaderFilter ok' }] } })
const RAW_ERR = JSON.stringify({ code: '5000', msg: 'pool not supported' })

describeGaps('patrol diagnosis-gaps 需求池端点', () => {
  // 并发跑批时 beforeAll 动态 import 链（better-sqlite3 + fastify + 种子）易撞 10s hook 默认超时——
  // 显式 30s（单跑 <10s，2026-11-26 并发红实锤后治理）。
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

    // 预置 MCP 池枚举缓存（11-20 14:48 判定真源）：P1/P2/P8=枚举内，P9/测试池-不存在=枚举外。
    // 测试不真连 MCP——meta 预置 + 内存缓存复位（patrolMcpPoolRegistry 读取链 内存→meta）。
    const registry = await import('../patrolMcpPoolRegistry.js')
    registry.clearPatrolMcpPoolEnumCache()
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta(registry.META_KEY_PATROL_MCP_POOL_ENUM, {
      pools: ['P1', 'P2', 'P8', '华南-广州3', '华北-北京3'],
      fetchedAt: new Date().toISOString(),
    })

    seedGaps()
  }, 30000)

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const authHeader = () => ({ authorization: `Bearer ${token}` })

  it('classifyGapKind 纯函数：四参矩阵（11-20 14:48 拍板：枚举真源 + mcp_error + 降级兜底）', async () => {
    const { classifyGapKind } = await import('./patrolQuery.js')
    // 无诊断记录=从未诊断（超龄收敛态）——不进需求池（11-20 拍板）
    expect(classifyGapKind(null, false)).toBe('undiagnosed')
    expect(classifyGapKind('anything', false)).toBe('undiagnosed')
    // 只有 failed 记录=诊断调用失败待重试——枚举态不影响此分类
    expect(classifyGapKind(null, false, true)).toBe('diagnosis_failed')
    expect(classifyGapKind(JSON.stringify({ error: 'MCP HTTP 412' }), true, true, true)).toBe('diagnosis_failed')
    expect(classifyGapKind(JSON.stringify({ error: 'MCP 调用超时（300000ms）' }), true, true, false)).toBe('diagnosis_failed') // error 形态优先于枚举态——防历史脏数据误报
    // 11-20 14:48 拍板：池不在枚举=未接入真源（静默空返回/任何 raw 形态都判未接入）
    expect(classifyGapKind(RAW_OK_EMPTY, true, true, false)).toBe('pool_uncovered')   // 枚举外池静默空返回——改前误进分区二
    expect(classifyGapKind(null, true, true, false)).toBe('pool_uncovered')
    expect(classifyGapKind(RAW_ERR, true, true, false)).toBe('pool_uncovered')
    // 枚举内池 + MCP 报错 → mcp_error（临时故障，补跑可愈，不进分区一）
    expect(classifyGapKind(null, true, true, true)).toBe('mcp_error')
    expect(classifyGapKind('plain error page without log lines', true, true, true)).toBe('mcp_error')
    expect(classifyGapKind(RAW_ERR, true, true, true)).toBe('mcp_error')                 // 枚举内池业务码非 0000
    // 枚举内池正常形态（不变）
    expect(classifyGapKind(RAW_OK_EMPTY, true, true, true)).toBe('log_not_collected')
    expect(classifyGapKind(RAW_OK_INFO, true, true, true)).toBe('failure_log_missing')
    expect(classifyGapKind('[2026-11-10 10:00:00] [ INFO] RequestIdFilter ok', true, true, true)).toBe('log_not_collected')
    const rawWithErr = JSON.stringify({ code: '0000', data: { records: [{ content: '[ERROR] boom' }] } })
    expect(classifyGapKind(rawWithErr, true, true, true)).toBe('other')                  // 防御位
    // 降级模式（poolInMcpEnum=null，MCP 清单不可达）——回退 11-20 修复后文本推断（保守方向）
    expect(classifyGapKind(null, true)).toBe('pool_uncovered')
    expect(classifyGapKind('', true)).toBe('pool_uncovered')
    expect(classifyGapKind('plain error page without log lines', true)).toBe('pool_uncovered')
    expect(classifyGapKind(RAW_ERR, true)).toBe('pool_uncovered')
    expect(classifyGapKind(RAW_OK_EMPTY, true)).toBe('log_not_collected')
    expect(classifyGapKind(RAW_OK_INFO, true)).toBe('failure_log_missing')
    // 兼容性：三参调用（历史消费方）默认降级模式，不误抛
    expect(classifyGapKind(RAW_OK_EMPTY, true, true)).toBe('log_not_collected')
  })

  it('summary 聚合（11-20 09:44 拍板：无时间窗口显示全部）：分区二接口聚合 + 分区一池汇总 + stats', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    // 分区二：4 个聚合键（eip|I1|P1 / eip|I1|P2——C 组异池 / eip|I8|P8——H 组按成功诊断归位 / eip|IJ|P1——J 组为枚举内池改造后不进分区二）
    expect(data.rows).toHaveLength(3)
    const main = data.rows.find((r) => r.poolName === 'P1')
    expect(main).toBeTruthy()
    expect(main.productName).toBeTruthy()
    expect(main.groupCount).toBe(2)                       // A+B（E 已 manual 逃逸）
    expect(main.preCompressTotal).toBe(4)                 // A(1)+B(3)
    expect(main.gapKinds).toEqual({ log_not_collected: 1, failure_log_missing: 1 })
    // requestIds：A.first → B.first → B.suppressed（与 first 重复的去重，保序）
    expect(main.requestIds).toEqual(['gap-a-first', 'gap-b-first', 'gap-a-sup-1', 'gap-a-sup-2'])
    expect(main.jiraTicketId).toBeNull()                 // Jira 扩展占位
    // 分区一（11-20 14:48 枚举真源）：P9（枚举外）只含 U 组——按「池不在枚举」判定，
    // 与 raw 形态无关；J 组（枚举外+静默空返回 records=[]）也在此——改前误进分区二
    expect(data.uncoveredPools).toHaveLength(2)
    const p9 = data.uncoveredPools.find((r) => r.poolName === 'P9')
    expect(p9.groupCount).toBe(1)
    expect(p9.sampleRequestId).toBe('gap-u-first')
    const pj = data.uncoveredPools.find((r) => r.poolName === '测试池-不存在')
    expect(pj.groupCount).toBe(1)
    expect(pj.requestIds).toEqual(['gap-j-first'])
    // 判定依据（11-20 拍板加列）：U 组的 MCP 错误响应样例
    expect(p9.sampleMcpRaw).toContain('pool not supported')
    // mcp_error 补跑清单（11-20 14:48 拍板）：K 组（枚举内池 P1+业务报错 RAW_ERR）——不进分区一/分区二
    expect(data.mcpErrorGroups).toHaveLength(1)
    expect(data.mcpErrorGroups[0].poolName).toBe('P1')
    expect(data.mcpErrorGroups[0].groupCount).toBe(1)
    expect(data.mcpErrorGroups[0].requestIds).toEqual(['gap-k-first'])
    expect(data.mcpErrorGroups[0].sampleMcpRaw).toContain('pool not supported')
    // poolEnum 响应字段（判定模式标注素材）
    expect(data.poolEnum.degraded).toBe(false)
    expect(data.poolEnum.count).toBe(5)
    expect(data.poolEnum.stale).toBe(false)
    expect(data.poolEnum.fetchedAt).toBeTruthy()
    // 未诊断清单（池维度汇总——复制交付补诊断）：D 组在列
    expect(data.undiagnosedGroups).toHaveLength(1)
    expect(data.undiagnosedGroups[0].poolName).toBe('P9')
    expect(data.undiagnosedGroups[0].groupCount).toBe(1)
    expect(data.undiagnosedGroups[0].requestIds).toEqual(['gap-d-first'])
    // stats：A+B+C+U+H+J = 6 需求池组 + D=1 未诊断 + I=1 诊断失败待重试 + K=1 mcp_error 补跑
    // （E 逃逸 F 无关 G 未诊断不计）
    expect(data.stats.groupCount).toBe(9)
    expect(data.stats.coveredCount).toBe(4)
    expect(data.stats.uncoveredCount).toBe(2)
    expect(data.stats.undiagnosedCount).toBe(1)
    expect(data.stats.retryPendingCount).toBe(1)
    expect(data.stats.mcpErrorCount).toBe(1)
    expect(data.stats.preCompressTotal).toBe(12)          // A1+B3+C1+U1+D1+H2+I1+J1+K1
    expect(data.stats.poolCount).toBe(5)                  // P1/P2/P9/P8/测试池-不存在
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
    expect(allRequestIds).not.toContain('gap-i-first')    // I 组只有 failed 诊断——11-20 拍板不纳入需求池（次日自动重试）
    expect(allRequestIds).not.toContain('gap-k-first')    // K 组枚举内池报错——mcp_error 补跑清单交付，不进需求池分区
  })

  it('11-20 误判修复红绿：success 后 failed 重试的组按成功诊断归分区二，不误报「池未接入」', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary',
      headers: authHeader(),
    })
    const data = res.json()
    // H 组（P8/I8）：先 success（records=0 → 日志未采集）后 failed（{"error":"MCP HTTP 412"}，id 更大）——
    // 改前 MAX(id) 取 failed 记录 → 误进分区一（华南-广州3/华北-北京3 误判场景）；改后按成功诊断进分区二
    expect(data.uncoveredPools.some((r) => r.poolName === 'P8')).toBe(false)
    const hRow = data.rows.find((r) => r.poolName === 'P8')
    expect(hRow).toBeTruthy()
    expect(hRow.apiPath).toBe('I8')
    expect(hRow.groupCount).toBe(1)
    expect(hRow.gapKinds).toEqual({ log_not_collected: 1, failure_log_missing: 0 })
    expect(hRow.requestIds).toEqual(['gap-h-first'])
    // I 组（P8/I8）：只有 failed 诊断——不进分区一/分区二/未诊断清单，仅 retryPendingCount 计数
    expect(data.uncoveredPools.flatMap((r) => r.requestIds)).not.toContain('gap-i-first')
    expect(data.stats.retryPendingCount).toBe(1)
  })

  it('11-20 14:48 枚举真源红绿：枚举外池静默空返回进分区一（改前误进分区二「查不到失败日志」）', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary',
      headers: authHeader(),
    })
    const data = res.json()
    // J 组（测试池-不存在，枚举外）：MCP 静默返回 {code:'0000', records:[]}（实测形态——池未接入不报错）。
    // 改前按 records=[] 判 log_not_collected 误进分区二；改后「池不在枚举」判 pool_uncovered 进分区一
    expect(data.uncoveredPools.some((r) => r.poolName === '测试池-不存在')).toBe(true)
    const jRow = data.rows.find((r) => r.poolName === '测试池-不存在')
    expect(jRow).toBeUndefined()
    // 枚举内池（P1）+业务报错（K 组）→ mcp_error 补跑清单；分区一不含 P1（池是接入的——报错≠未接入）
    expect(data.uncoveredPools.some((r) => r.poolName === 'P1')).toBe(false)
    expect(data.mcpErrorGroups.some((r) => r.poolName === 'P1')).toBe(true)
    expect(data.mcpErrorGroups.flatMap((r) => r.requestIds)).toEqual(['gap-k-first'])
  })

  it('11-21 豁免白名单红绿：命中组退出分区二/分区一；同客户其他接口不受影响', async () => {
    // 前置：A 组（userA×I1 在分区二 P1 聚合行）设为豁免组合——A 退出分区二；B 组（userB×I1 同接口不同客户）保留
    const { putPatrolActionExemptions, clearPatrolActionExemptionsCache } = await import('../patrolActionExemptions.js')
    clearPatrolActionExemptionsCache()
    putPatrolActionExemptions([{ id: 't1', userName: 'userA', apiPath: 'I1', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary',
      headers: authHeader(),
    })
    const data = res.json()
    // 分区二 P1|I1 聚合行：只剩 B 组（A 被豁免过滤——改前红：groupCount=2）
    const p1Row = data.rows.find((r) => r.poolName === 'P1' && r.apiPath === 'I1')
    expect(p1Row).toBeTruthy()
    expect(p1Row.groupCount).toBe(1)
    expect(p1Row.requestIds).not.toContain('gap-a-first')
    expect(p1Row.requestIds).toContain('gap-b-first')
    // 分区一：若把豁免组合指向 U 组（userU×I9 枚举外池）——U 退出分区一（防豁免组混入未接入池清单）
    putPatrolActionExemptions([{ id: 't2', userName: 'userU', apiPath: 'I9', note: '', enabled: true, createdAt: 't' }], { username: 'test' })
    const res2 = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary',
      headers: authHeader(),
    })
    const data2 = res2.json()
    // P9 在分区一本只有 U 组（D 是 undiagnosed 不进分区一）——U 被豁免后该池无未接入组，整行消失
    const p9 = data2.uncoveredPools.find((r) => r.poolName === 'P9')
    expect(p9).toBeUndefined()                      // 豁免组不进分区一（改前红：P9 行存在且含 gap-u-first）
    expect(JSON.stringify(data2.uncoveredPools)).not.toContain('gap-u-first')
    // 同池其他客户的组不受影响：D 组（userD）仍在未诊断清单（豁免过滤只作用于分区一/二）
    expect(data2.undiagnosedGroups.some((r) => r.poolName === 'P9' && r.requestIds.includes('gap-d-first'))).toBe(true)
    // 清理：测试豁免规则不泄漏到其他用例
    putPatrolActionExemptions([], { username: 'test' })
    clearPatrolActionExemptionsCache()
  })

  it('groups 联动：rootCauseL1=诊断能力缺口 过滤出 9 组（E 逃逸/F 无关/G 未诊断排除）', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/patrol/failures/groups?startDate=2026-11-10&endDate=2026-11-11&rootCauseL1=' + encodeURIComponent('诊断能力缺口'),
      headers: authHeader(),
    })
    expect(res.json().rows).toHaveLength(9)
    expect(res.json().rows.some((r) => r.firstRequestId === 'gap-e-first')).toBe(false)
  })

  it('一键导出（11-25 23:59 拍板）：xlsx 两 sheet 与 summary 同源（分区一/分区二），8 月组不进', async () => {
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/export',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    expect(String(res.headers['content-type'] || '')).toContain('spreadsheetml')
    // xlsx 二进制可解析且两 sheet 齐
    const XLSX = await import('xlsx')
    const wb = XLSX.read(res.rawPayload, { type: 'buffer' })
    expect(wb.SheetNames).toEqual(['分区一-池未接入MCP', '分区二-诊断能力不足'])
    const unc = XLSX.utils.sheet_to_json(wb.Sheets['分区一-池未接入MCP'])
    const cov = XLSX.utils.sheet_to_json(wb.Sheets['分区二-诊断能力不足'])
    // 与 summary 同源：分区一含枚举外池 P9（seed J/U 组），分区二 3 聚合；8 月组不进
    expect(unc.some((r) => r['资源池'] === 'P9')).toBe(true)
    expect(cov.length).toBe(3)
    expect(JSON.stringify(cov)).not.toContain('I8-aug')
  })

  it('导出 32767 单元格上限红绿（11-26 线上 500 修复）：超量 requestId 分块续行不炸 write', async () => {
    // 种一个聚合内 1000+ id 的缺口组（真实链路规模——线上 500 复现形态：id 清单整列 join 超 xlsx 单元格上限）
    const db = require_getDb()
    const ids = Array.from({ length: 1200 }, (_, i) => `reqId-${String(i).padStart(32, 'x')}`)
    db.prepare(`
      INSERT INTO api_patrol_failure_groups
        (group_date, product_key, pool_name, api_path, metric_name, user_name,
         first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
         customer_type, root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
      VALUES ('2026-11-15', 'eip', 'P1', 'I-many', '绑定', 'userMany', ?, '2026-11-15 10:00:00', 1, ?,
              '', '诊断能力缺口', null, '—', 't', 't')
    `).run(ids[0], JSON.stringify(ids.slice(1)))
    db.prepare(`
      INSERT INTO api_patrol_diagnoses
        (failure_group_id, request_id, status, tool_name, mcp_raw_response, diagnosed_at)
      VALUES (?, ?, 'success', 'log_search', ?, 't')
    `).run(
      db.prepare(`SELECT id FROM api_patrol_failure_groups WHERE first_request_id=?`).get(ids[0]).id,
      ids[0],
      '{"code":"0000","msg":null,"data":{"records":[],"total":0}}',
    )
    const res = await app.inject({ method: 'GET', url: '/api/patrol/diagnosis-gaps/export', headers: authHeader() })
    // 改前红：write 抛「Text length must not exceed 32767」→ 500；改后 200 + id 分块续行
    expect(res.statusCode).toBe(200)
    const XLSX = await import('xlsx')
    const wb = XLSX.read(res.rawPayload, { type: 'buffer' })
    const cov = XLSX.utils.sheet_to_json(wb.Sheets['分区二-诊断能力不足'])
    const manyRows = cov.filter((r) => r['接口'] === 'I-many' || (!r['接口'] && r['requestId 清单']))
    // 1200 id ÷ 约12/块 ≈ 100 块：首行带维度、续行维度空 id 列续接——单格均 < 上限
    expect(manyRows.length).toBeGreaterThan(80)
    for (const r of manyRows) {
      expect(String(r['requestId 清单'] || '').length).toBeLessThan(32767)
    }
    // 自清理（防污染后序用例的 groupCount 断言——顺序耦合教训）
    db.prepare(`DELETE FROM api_patrol_diagnoses WHERE request_id LIKE 'reqId-x%'`).run()
    db.prepare(`DELETE FROM api_patrol_failure_groups WHERE first_request_id LIKE 'reqId-x%'`).run()
  })

  it('时间窗口守卫（11-25 23:59 拍板：下界 2026-11-10）：8 月 E2E 样例组不进需求池（11-20「显示全部」废止）', async () => {
    // 种一个 8 月缺口组（E2E 样例数据形态——8月10日/8月11日 CSV 导入的组）
    const db = require_getDb()
    db.prepare(`
      INSERT INTO api_patrol_failure_groups
        (group_date, product_key, pool_name, api_path, metric_name, user_name,
         first_request_id, first_request_time, pre_compress_count, suppressed_request_ids,
         customer_type, root_cause_l1, root_cause_l2, product_action_status, created_at, updated_at)
      VALUES ('2026-08-10', 'eip', 'P8', 'I8-aug', '绑定', 'userAug', 'gap-aug-first', '2026-08-10 10:00:00', 2, '[]',
              '', '诊断能力缺口', null, '—', 't', 't')
    `).run()
    const insertDiagAug = db.prepare(`
      INSERT INTO api_patrol_diagnoses
        (failure_group_id, request_id, status, tool_name, mcp_raw_response, diagnosed_at)
      VALUES (?, 'gap-aug-first', 'success', 'log_search', ?, 't')
    `)
    insertDiagAug.run(db.prepare(`SELECT id FROM api_patrol_failure_groups WHERE first_request_id='gap-aug-first'`).get().id, '{"code":"0000","msg":null,"data":{"records":[],"total":0}}')
    const res = await app.inject({
      method: 'GET', url: '/api/patrol/diagnosis-gaps/summary?startDate=2026-01-01&endDate=2026-12-31',
      headers: authHeader(),
    })
    expect(res.statusCode).toBe(200)
    const data = res.json()
    // 窗口内 seed 9 组不变；8 月组被下界挡掉——组数与分区不含它（改前红：显示全部口径会含 8 月组=10）
    expect(data.stats.groupCount).toBe(9)
    expect(data.rows.some((r) => r.apiPath === 'I8-aug')).toBe(false)
    expect(data.uncoveredPools.some((p) => p.poolName === 'P8')).toBe(false)
  })
})

/** seed：A/B 同键双形态 / C 异池 / U MCP错误(枚举外池) / D 无诊断记录 / E manual逃逸 / F 无关 / G 未诊断 /
 * H success后failed重试（误判修复红绿）/ I 只有failed诊断（待自动重试）/
 * J 枚举外池+静默空返回（11-20 14:48 枚举真源红绿——改前误进分区二）/ K 枚举内池+业务报错（→mcp_error 补跑清单） */
function seedGaps() {
  // 预置 MCP 池枚举 meta 缓存（11-20 14:48 拍板判定真源）——测试不真连 MCP；
  // P1/P2/P8=枚举内，P9/测试池-不存在=枚举外。ESM 下 require 不可用——动态 import 后同步预置。
  // （vitest ESM 顶层 await 可用；seedGaps 保持同步签名，内部用已 import 的模块引用——见 beforeAll 的模块级缓存）
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
  insertGroup.run('2026-11-10', 'P1', 'I1', 'userA', 'gap-a-first', '2026-11-10 10:00:00', 1, '[]', '诊断能力缺口', null, null)
  // B：失败日志缺失（INFO only），pre=3 = first + 2 suppressed（其中 1 个与 first 重复——测去重）
  insertGroup.run('2026-11-10', 'P1', 'I1', 'userB', 'gap-b-first', '2026-11-10 11:00:00', 3, '["gap-b-first","gap-a-sup-1","gap-a-sup-2"]', '诊断能力缺口', null, null)
  // C：异池（2026-11-11）
  insertGroup.run('2026-11-11', 'P2', 'I1', 'userC', 'gap-c-first', '2026-11-11 10:00:00', 1, '[]', '诊断能力缺口', null, null)
  // U：MCP 错误响应（池 P9 未接入）
  insertGroup.run('2026-11-10', 'P9', 'I9', 'userU', 'gap-u-first', '2026-11-10 12:00:00', 1, '[]', '诊断能力缺口', null, null)
  // D：无诊断记录（fetch 失败形态）池 P9
  insertGroup.run('2026-11-10', 'P9', 'I9', 'userD', 'gap-d-first', '2026-11-10 13:00:00', 1, '[]', '诊断能力缺口', null, null)
  // E：manual 逃逸（原始缺口 + 人工修正业务冲突）
  insertGroup.run('2026-11-10', 'P1', 'I1', 'userE', 'gap-e-first', '2026-11-10 14:00:00', 1, '[]', '诊断能力缺口', null, '业务冲突')
  // F：无关组（业务冲突）
  insertGroup.run('2026-11-10', 'P1', 'IF', 'userF', 'gap-f-first', '2026-11-10 15:00:00', 1, '[]', '业务冲突', null, null)
  // G：未诊断
  insertGroup.run('2026-11-10', 'P1', 'IG', 'userG', 'gap-g-first', '2026-11-10 16:00:00', 1, '[]', null, null, null)
  // H：先 success 诊断（日志未采集）后 failed 重试（MCP HTTP 412）——池 P8 实际已接入（误判修复红绿）
  insertGroup.run('2026-11-10', 'P8', 'I8', 'userH', 'gap-h-first', '2026-11-10 12:30:00', 2, '[]', '诊断能力缺口', null, null)
  // I：只有 failed 诊断（MCP 超时）——组保持 pending_diagnosis 次日自动重试，不纳入需求池
  insertGroup.run('2026-11-10', 'P8', 'I8', 'userI', 'gap-i-first', '2026-11-10 13:30:00', 1, '[]', '诊断能力缺口', null, null)
  // J：枚举外池 + MCP 静默空返回（11-20 14:48 实测形态——池未接入不报错，code 0000+records=[]）。
  // 枚举真源红绿组：改前按 records=[] 误进分区二；改后「池不在枚举」判 pool_uncovered 进分区一
  insertGroup.run('2026-11-10', '测试池-不存在', 'IJ', 'userJ', 'gap-j-first', '2026-11-10 17:00:00', 1, '[]', '诊断能力缺口', null, null)
  // K：枚举内池（P1）+ MCP 业务报错（code 5000）——11-20 14:48 拍板新类 mcp_error（临时故障补跑清单），
  // 不再误进分区一（报错≠未接入）
  insertGroup.run('2026-11-10', 'P1', 'IK', 'userK', 'gap-k-first', '2026-11-10 18:00:00', 1, '[]', '诊断能力缺口', null, null)

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
    // gap-d-first 无诊断记录（D 组从未诊断）
    ['gap-e-first', RAW_OK_EMPTY],
    // H 组先插 success 记录（随后追加 failed 重试记录——id 更大，复现 MAX(id) 不分成败的误判形态）
    ['gap-h-first', RAW_OK_EMPTY],
    // J 组：枚举外池静默空返回（实测：池未接入不报错——与 RAW_OK_EMPTY 形态相同，靠枚举判定区分）
    ['gap-j-first', RAW_OK_EMPTY],
    // K 组：枚举内池业务报错 → mcp_error
    ['gap-k-first', RAW_ERR],
  ]) {
    const g = byFirst.get(firstId)
    insertDiag.run(g.id, firstId, raw)
  }
  // 诊断失败记录（patrolDiagnose 失败路径形态：status='failed' + {"error":...}）——H 追加重试失败、I 仅此一条
  const insertDiagFailed = db.prepare(`
    INSERT INTO api_patrol_diagnoses
      (failure_group_id, request_id, status, tool_name, mcp_raw_response, final_conclusion,
       root_cause_l1, root_cause_l2, root_cause_source, diagnosed_at)
    VALUES (?, ?, 'failed', 'log_search', ?, NULL, NULL, NULL, NULL, 't')
  `)
  for (const [firstId, raw] of [
    ['gap-h-first', JSON.stringify({ error: 'MCP HTTP 412' })],
    ['gap-i-first', JSON.stringify({ error: 'MCP 调用超时（300000ms）' })],
  ]) {
    const g = byFirst.get(firstId)
    insertDiagFailed.run(g.id, firstId, raw)
  }
}
