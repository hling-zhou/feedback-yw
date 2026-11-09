import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import http from 'node:http'
import Papa from 'papaparse'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'

/**
 * API 巡检端到端测试（M8 · 全项目集成验收闸门）。
 * 真实链路：样例 CSV 全量（92 stats + 8406 requests）→ 真实推送端点（真实 API Key）→
 * admin 触发压缩 → mock MCP 诊断（返回样例 pushed_diagnose JSON——走真实解析链，不绕过）→
 * 全链路对拍：入库数/is_success 分布/压缩不变式/分类分布=§6.3 黄金表 ±0/幂等重导。
 * 导入脚本 scripts/import-api-patrol-samples.mjs 复用本测试的推送函数。
 */

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-e2e-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-e2e-xx'

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

const SAMPLE_DIR = path.join(process.cwd(), 'data', 'API 巡检', '原始数据样例')

/** 期望黄金值（设计文档 §6.3 + 样例全量实测） */
const GOLDEN = {
  statsRows: 92,
  sourceRows: 8406,        // 源 CSV 总行数
  requestRows: 8398,        // distinct (date,pool,requestId)——样例含 8 个批内重复（全为成功行，后者覆盖）
  successRows: 4301,
  failRows: 4097,
  l2Counts: {
    '诊断能力缺口/日志缺失/无数据': 1968,
    '参数无效/校验失败/域名与比较类型成对': 1786,
    '资源锁定/并发冲突/锁定机制待查': 113,
    '资源锁定/并发冲突/并发进行中': 96,
    '业务冲突/绑定关系未解除': 38,
    '资源状态异常/负载均衡器本体': 18,
    '其他/未归类/兜底': 16,
    '配额不足/通用配额': 16,
    '业务冲突/HAVIP绑定业务校验': 12,
    '诊断能力缺口/日志无ERROR/WARN': 11,
    '参数无效/校验失败/IP/资源ID/地址类': 6,
    '配额不足/HAVIP数量上限': 5,
    '诊断能力缺口/仅WARN结论不明': 5,
    '资源状态异常/后端服务器组': 2,
    '业务冲突/资源被他人占用': 4,
    '业务冲突/DNAT规则冲突': 1,
  },
  pendingGroups: 204,
}

describe.skipIf(!sqliteAvailable)('API 巡检端到端（样例全量走真实链路）', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app
  let adminToken = ''
  let pushKeySecret = ''
  /** @type {import('better-sqlite3').Database} */
  let db
  /** @type {import('node:http').Server} */
  let mcpServer
  let mcpPort = 0

  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    db = getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()

    // 真实 API Key（patrol:push）
    const { apiKeyRepository } = await import('../apiKeyRepository.js')
    pushKeySecret = apiKeyRepository.createApiKey({ name: 'e2e-pusher', scopes: ['patrol:push'] }).secret

    // admin token（触发压缩）
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({
      username: 'e2e_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin',
    })
    adminToken = signAccessToken(admin)

    // 产品目录（推送产品名映射）
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1, updatedAt: 't', products: [
        { key: 'eip', name: '弹性公网IP', enabled: true },
        { key: 'vpc', name: '虚拟私有云', enabled: true },
        { key: 'slb', name: '弹性负载均衡', enabled: true },
      ], deletedKeys: [], disabledAnalysisKeys: [],
    })

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolPushRoutes } = await import('./patrolPush.js')
    const { registerPatrolQueryRoutes } = await import('./patrolQuery.js')
    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerAuthHooks(app)
    registerPatrolPushRoutes(app)
    registerPatrolQueryRoutes(app)
    await app.ready()

    // mock MCP 服务：返回每条失败请求的 pushed_diagnose JSON（走真实解析链）
    mcpServer = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        /** @type {Record<string, unknown>} */
        let parsed = {}
        try { parsed = JSON.parse(body) } catch { /* ignore */ }
        const args = /** @type {{ arguments?: { filter?: string, requestId?: string } }} */ (parsed.params || {})
        const rid = String(args.arguments?.filter || args.arguments?.requestId || '')
        // 从 pushed_diagnose 反查：diagMap 在模块级由 seedMcpMap 注入
        const text = mcpDiagMap.get(rid) || JSON.stringify({ final_conclusion: '日志查询异常/无数据-mock' })
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: parsed.id,
          result: { content: [{ type: 'text', text }] },
        }))
      })
    })
    await new Promise((resolve) => { mcpServer.listen(0, '127.0.0.1', () => resolve(null)) })
    mcpPort = /** @type {import('net').AddressInfo} */ (/** @type {unknown} */ (mcpServer.address())).port

    await pushAllSamples()
  })

  afterAll(async () => {
    await app?.close()
    await new Promise((resolve) => { mcpServer.close(() => resolve(null)) })
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  /** requestId → pushed_diagnose 原文（mock MCP 据此返回，走真实解析链） */
  const mcpDiagMap = new Map()
  /** @type {Map<string, {received: number, inserted: number, overwritten: number, ignored: number}>} */
  const pushLog = new Map()

  /** 推送样例全量（stats + requests 两端点，5000 行分批） */
  async function pushAllSamples() {
    const keyHeader = { authorization: `Bearer ${pushKeySecret}`, 'content-type': 'application/json' }

    // ── stats：异常接口统计 CSV（每文件=产品，行带 资源池/日期在行内）──
    const statsFiles = fs.readdirSync(path.join(SAMPLE_DIR, '异常接口统计'))
    for (const dirName of statsFiles) {
      const productDir = path.join(SAMPLE_DIR, '异常接口统计', dirName)
      if (!fs.statSync(productDir).isDirectory()) continue
      for (const file of fs.readdirSync(productDir)) {
        const date = cnDateToIso(file.replace(/\.csv$/, ''))
        if (!date) continue
        const content = fs.readFileSync(path.join(productDir, file), 'utf8')
        const rows = Papa.parse(content, { header: true, skipEmptyLines: true }).data
        const res = await app.inject({
          method: 'POST', url: '/api/patrol/push/stats',
          headers: keyHeader,
          payload: { product: dirName, date, rows },
        })
        if (res.statusCode !== 200) throw new Error(`stats push 失败 ${dirName} ${date}: ${res.body}`)
        const j = res.json()
        pushLog.set(`stats|${dirName}|${date}`, j)
      }
    }

    // ── requests：明细 CSV（eip_vpc / elb 两包，单文件=单日单池，>5000 分批）──
    for (const [packageId, dirName] of [['eip_vpc', '弹性公网IP_虚拟私有云'], ['elb', '弹性负载均衡']]) {
      const dir = path.join(SAMPLE_DIR, '明细', dirName)
      for (const file of fs.readdirSync(dir)) {
        const m = /^(\d+月\d+日)_(.+)\.csv$/.exec(file)
        if (!m) continue
        const date = cnDateToIso(m[1])
        const pool = m[2]
        const content = fs.readFileSync(path.join(dir, file), 'utf8')
        const rows = Papa.parse(content, { header: true, skipEmptyLines: true }).data
        // requestId → pushed_diagnose（mock MCP 映射；仅失败行有诊断）
        for (const row of rows) {
          const failed = packageId === 'elb' ? String(row.resultStatus).trim() === 'FAILED' : String(row.result).trim() === '0'
          if (failed && row.diagnoseResult) {
            mcpDiagMap.set(String(row.requestId), String(row.diagnoseResult))
          }
        }
        for (let i = 0; i < rows.length; i += 5000) {
          const res = await app.inject({
            method: 'POST', url: '/api/patrol/push/requests',
            headers: keyHeader,
            payload: { package: packageId, date, pool, rows: rows.slice(i, i + 5000) },
          })
          if (res.statusCode !== 200) throw new Error(`requests push 失败 ${file}: ${res.body}`)
          const j = res.json()
          const k = `requests|${file}|${i}`
          pushLog.set(k, j)
        }
      }
    }
  }

  it('13.1 全量入库对拍：92 stats + 8406 requests；is_success 分布 4309/4097；ignored=0', () => {
    const statsCount = db.prepare(`SELECT COUNT(*) n FROM api_patrol_stats`).get()
    expect(/** @type {{n: number}} */ (statsCount).n).toBe(GOLDEN.statsRows)
    const reqCount = db.prepare(`SELECT COUNT(*) n FROM api_patrol_requests`).get()
    expect(/** @type {{n: number}} */ (reqCount).n).toBe(GOLDEN.requestRows)
    const dist = db.prepare(`SELECT is_success, COUNT(*) n FROM api_patrol_requests GROUP BY is_success`).all()
    const map = Object.fromEntries(dist.map((r) => [String(/** @type {{is_success: number}} */ (r).is_success), Number(/** @type {{n: number}} */ (r).n)]))
    expect(map['1']).toBe(GOLDEN.successRows) // P1 批判修正：成功行分布守卫
    expect(map['0']).toBe(GOLDEN.failRows)
    const totalIgnored = [...pushLog.values()].reduce((a, j) => a + (j.ignored || 0), 0)
    expect(totalIgnored).toBe(0)
    // 守恒：入库 distinct 行 + 批内去重数 = 源行数（8 个批内重复）
    expect(/** @type {{n: number}} */ (reqCount).n + (GOLDEN.sourceRows - GOLDEN.requestRows)).toBe(GOLDEN.sourceRows)
  })

  it('13.3 admin 触发压缩：不变式（Σpre_compress_count=4097；requestId 全集恰属一组无交叠）', async () => {
    const dateRows = db.prepare(`SELECT DISTINCT request_date d FROM api_patrol_requests ORDER BY d`).all()
    const allDates = dateRows.map((r) => String(/** @type {{d: string}} */ (r).d))
    expect(allDates).toEqual(['2026-08-03','2026-08-04','2026-08-05','2026-08-06','2026-08-07','2026-08-08','2026-08-09','2026-08-10','2026-08-11','2026-08-12'])
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/admin/process',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: { dates: allDates },
    })
    expect(res.statusCode).toBe(200)
    const compressed = res.json().compressed
    // 不变式 1：Σpre_compress_count = 失败总数（独立复算）
    const sum = compressed.reduce((a, r) => a + Number(r.compressedFrom), 0)
    expect(sum).toBe(GOLDEN.failRows)
    // 不变式 2：requestId 全集=首条∪suppressed，无交叠、全覆盖
    const groups = db.prepare(`SELECT first_request_id, suppressed_request_ids FROM api_patrol_failure_groups`).all()
    const allIds = []
    for (const g of groups) {
      allIds.push(String(/** @type {{first_request_id: string}} */ (g).first_request_id))
      for (const rid of JSON.parse(String(/** @type {{suppressed_request_ids: string}} */ (g).suppressed_request_ids))) allIds.push(rid)
    }
    expect(new Set(allIds).size).toBe(allIds.length) // 无交叠
    const failIds = db.prepare(`SELECT COUNT(DISTINCT request_id) n FROM api_patrol_requests WHERE is_success=0 AND api_path != ''`).get()
    expect(allIds.length).toBe(/** @type {{n: number}} */ (failIds).n) // 全覆盖（空接口名行不入压缩）
  })

  it('13.4 admin 触发诊断（mock MCP 返回 pushed_diagnose，走真实解析链）：组级分布=独立复算 ±0', async () => {
    const dates = [...new Set(db.prepare(`SELECT DISTINCT group_date d FROM api_patrol_failure_groups`).all()
      .map((r) => String(/** @type {{d: string}} */ (r).d)))]
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/admin/process',
      headers: { authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' },
      payload: {
        dates,
        runDiagnose: true,
        mcpEndpoint: `http://127.0.0.1:${mcpPort}/mcp`,
        mcpToken: 'e2e-mock',
      },
    })
    expect(res.statusCode).toBe(200)

    // ── 独立复算期望分布（P3 批判修正：不用实现自己的分组，测试内独立实现）──
    // 1) 取全部失败行的 (date, pool, api, user, requestId, time, pushed_diagnose, isElb)
    const failRows = db.prepare(`
      SELECT request_date d, pool_name pool, api_path api, user_name u,
             request_id rid, request_time t, pushed_diagnose diag, product_key pk
      FROM api_patrol_requests WHERE is_success=0 AND api_path != ''
      ORDER BY t
    `).all()
    // 2) 独立分组：键=(date, pool, api, user)，组首=时间最小行；1h 链式（窗口 3600s）
    const { classifyPatrolRootCause, extractDiagnosticText } = await import('../patrolRootCauseClassifier.js')
    const { API_PATROL_ROOT_CAUSE_RULES_SEED } = await import('../patrolSeeds.js')
    const rules = API_PATROL_ROOT_CAUSE_RULES_SEED
    /** @type {Map<string, Array<{rid: string, t: string, diag: string|null, pk: string|null}>>} */
    const groups = new Map()
    for (const r of failRows) {
      const key = `${String(r.d)}|${String(r.pool)}|${String(r.api)}|${String(r.u)}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push({ rid: String(r.rid), t: String(r.t), diag: /** @type {string|null} */ (r.diag), pk: /** @type {string|null} */ (r.pk) })
    }
    /** @type {Record<string, number>} */
    const expectedLine = {}
    let expectedPending = 0
    for (const chain of groups.values()) {
      // 链式切分（窗口 3600s）
      let chainStart = 0
      for (let i = 1; i <= chain.length; i++) {
        const isBreak = i === chain.length ||
          (new Date(chain[i].t.replace(' ', 'T')).getTime() - new Date(chain[i - 1].t.replace(' ', 'T')).getTime()) > 3600_000
        if (isBreak) {
          const seg = chain.slice(chainStart, i)
          const first = seg[0]
          const text = extractDiagnosticText(String(first.diag || ''), '', first.pk === 'slb')
          const cls = classifyPatrolRootCause(text, rules)
          const key = `${cls.l1}/${cls.l2}`
          expectedLine[key] = (expectedLine[key] || 0) + seg.length
          if (cls.productAction === '待处理') expectedPending += seg.length
          chainStart = i
        }
      }
    }
    // 3) 实际分布：组的分类 × 组内行数（与图/统计同源口径）
    const groupRows = db.prepare(`
      SELECT root_cause_l1 l1, root_cause_l2 l2, pre_compress_count pre, product_action_status status
      FROM api_patrol_failure_groups WHERE root_cause_l1 IS NOT NULL
    `).all()
    /** @type {Record<string, number>} */
    const actualLine = {}
    let actualPending = 0
    for (const g of groupRows) {
      const key = `${String(g.l1)}/${String(g.l2)}`
      actualLine[key] = (actualLine[key] || 0) + Number(g.pre)
      if (String(g.status) === '待处理') actualPending += Number(g.pre)
    }
    // 4) 对拍：独立复算分布 = 实际组级分布（±0）
    const keys = new Set([...Object.keys(expectedLine), ...Object.keys(actualLine)])
    for (const k of keys) {
      expect(`${k}: ${actualLine[k] ?? 0} vs 期望 ${expectedLine[k] ?? 0}`).toBe(`${k}: ${expectedLine[k] ?? 0} vs 期望 ${expectedLine[k] ?? 0}`)
    }
    expect(actualPending).toBe(expectedPending)
    // 组级待处理必然 > 0（样例含大量锁定类待处理）
    expect(actualPending).toBeGreaterThan(0)
  })

  it('13.2 幂等重导：同批重推 → 全 overwritten、inserted=0、组数不变', async () => {
    const groupsBefore = db.prepare(`SELECT COUNT(*) n FROM api_patrol_failure_groups`).get()
    // 重推 stats 一批
    const statsRes = await app.inject({
      method: 'POST', url: '/api/patrol/push/stats',
      headers: { authorization: `Bearer ${pushKeySecret}`, 'content-type': 'application/json' },
      payload: {
        product: '弹性公网IP', date: '2026-08-10',
        rows: [{ '资源池': '华南-广州3', '指标名称': '订购', '接口名称': '/customer/v3/order/create/floatingip', '业务类型': '订购', '成功率': '88.89%', '正常比例': '87.5%', '时长均值': '29.27s' }],
      },
    })
    expect(statsRes.json()).toMatchObject({ inserted: 0, overwritten: 1 })
    // 重推 requests 一批（样例真行）
    const content = fs.readFileSync(path.join(SAMPLE_DIR, '明细', '弹性公网IP_虚拟私有云', '8月10日_华南-广州3.csv'), 'utf8')
    const rows = Papa.parse(content, { header: true, skipEmptyLines: true }).data
    const reqRes = await app.inject({
      method: 'POST', url: '/api/patrol/push/requests',
      headers: { authorization: `Bearer ${pushKeySecret}`, 'content-type': 'application/json' },
      payload: { package: 'eip_vpc', date: '2026-08-10', pool: '华南-广州3', rows },
    })
    expect(reqRes.statusCode).toBe(200)
    expect(reqRes.json().inserted).toBe(0)
    const groupsAfter = db.prepare(`SELECT COUNT(*) n FROM api_patrol_failure_groups`).get()
    expect(/** @type {{n: number}} */ (groupsAfter).n).toBe(/** @type {{n: number}} */ (groupsBefore).n)
  })
})

/** '8月10日' → '2026-08-10'（样例文件名约定）。 */
function cnDateToIso(cn) {
  const m = /^(\d+)月(\d+)日$/.exec(cn)
  if (!m) return ''
  return `2026-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}`
}
