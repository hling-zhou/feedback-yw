import fs from 'node:fs'
import os from 'node:os'
import http from 'node:http'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

/**
 * 产品API日志诊断配置（MCP）——存储与消费守卫测试。
 * 模式与 llm_config_v1 同构：通用 meta GET 禁明文、PUT 留空保留 token、专属审计动作、脱敏 GET、
 * admin/process 解析链（显式传参 > 库 > 环境变量）。
 * env 先行设置 + 动态 import（db.js 模块顶层算路径，静态 import 被 hoist 会落回真库）。
 */
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-mcp-cfg-'))
process.env.AUTH_DATABASE_PATH = path.join(TMP_DIR, 't.db')
process.env.SERVER_DATA_DIR = TMP_DIR
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-mcp-cfg-xx'

const sqliteMod = await import('../db.js').catch(() => null)
const sqliteAvailable = Boolean(sqliteMod?.getDb)
const dbApi = sqliteAvailable
  ? sqliteMod
  : /** @type {any} */ ({})
const { getDb, closeDb } = dbApi

describe.skipIf(!sqliteAvailable)('patrol MCP 配置：存储与消费守卫', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null
  let adminToken = ''
  let editorToken = ''
  /** @type {any} */
  let db = null
  /** @type {import('http').Server | null} */
  let mockMcp = null
  let mockMcpPort = 0
  /** @type {string[]} */
  let mockAuthHeaders = []

  beforeAll(async () => {
    getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()
    db = getDb()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({ username: 't_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin' })
    const editor = await createUser({ username: 't_editor', password: 'EditorPass12345!', team: '综合管理组', role: 'editor' })
    adminToken = signAccessToken(admin)
    editorToken = signAccessToken(editor)

    const Fastify = (await import('fastify')).default
    const { registerAuthHooks } = await import('../middleware.js')
    const { registerStorageRoutes } = await import('./storage.js')
    const { registerPatrolQueryRoutes } = await import('./patrolQuery.js')
    app = Fastify({ logger: false })
    registerAuthHooks(app)
    registerStorageRoutes(app)
    registerPatrolQueryRoutes(app)
    await app.ready()

    // mock MCP（JSON-RPC tools/call → result.content[].text，对齐 patrolDiagnose.js 契约）
    mockMcp = http.createServer((req, res) => {
      let body = ''
      req.on('data', (c) => { body += c })
      req.on('end', () => {
        mockAuthHeaders.push(String(req.headers.authorization || ''))
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({
          jsonrpc: '2.0', id: 1,
          result: { content: [{ type: 'text', text: '{"final_conclusion":"负载均衡器正在更新中，请稍后重试"}' }] },
        }))
      })
    })
    mockMcp.listen(0, '127.0.0.1')
    await new Promise((r) => { if (mockMcp) mockMcp.once('listening', r) })
    mockMcpPort = /** @type {import('net').AddressInfo} */ (/** @type {any} */ (mockMcp).address()).port
  })

  afterAll(async () => {
    await app?.close()
    mockMcp?.close()
    closeDb()
    delete process.env.PATROL_MCP_ENDPOINT
    delete process.env.PATROL_MCP_TOKEN
  })

  const adminHeader = () => ({ authorization: `Bearer ${adminToken}`, 'content-type': 'application/json' })
  const editorHeader = () => ({ authorization: `Bearer ${editorToken}`, 'content-type': 'application/json' })

  it('① 通用 meta GET 对 api_patrol_mcp_config_v1 禁明文（403 指引专用端点）', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/storage/meta/api_patrol_mcp_config_v1', headers: adminHeader() })
    expect(res.statusCode).toBe(403)
    expect(res.json().error).toContain('mcp-config')
  })

  it('② admin PUT 保存 → 入库 + 审计不落 token 明文', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/storage/meta/api_patrol_mcp_config_v1', headers: adminHeader(),
      payload: { value: { mcpEndpoint: 'http://cni.api.mcp:31788/mcp', mcpToken: 'sk-patrol-secret-987654' } },
    })
    expect(res.statusCode).toBe(200)
    const entry = db.prepare(
      "SELECT detail_json d FROM audit_log WHERE action='storage.patrol_mcp_config_update' ORDER BY id DESC LIMIT 1",
    ).get()
    expect(entry).toBeTruthy()
    const detail = JSON.parse(String(/** @type {{d: string}} */ (entry).d))
    expect(JSON.stringify(detail)).not.toContain('sk-patrol-secret-987654')
    expect(detail.tokenChanged).toBe(true)
  })

  it('③ PUT 留空 token → 保留现有（服务端合并）', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/storage/meta/api_patrol_mcp_config_v1', headers: adminHeader(),
      payload: { value: { mcpEndpoint: 'http://10.233.1.22:8080/mcp-server' } }, // 未带 token
    })
    expect(res.statusCode).toBe(200)
    const cfg = db.prepare("SELECT value FROM meta WHERE key='api_patrol_mcp_config_v1'").get()
    const parsed = JSON.parse(String(/** @type {{value: string}} */ (cfg).value))
    expect(parsed.mcpToken).toBe('sk-patrol-secret-987654') // 未被空值抹掉
    expect(parsed.mcpEndpoint).toBe('http://10.233.1.22:8080/mcp-server')
  })

  it('④ editor（无 managePatrolMcpConfig）PUT → 403', async () => {
    const res = await app.inject({
      method: 'PUT', url: '/api/storage/meta/api_patrol_mcp_config_v1', headers: editorHeader(),
      payload: { value: { mcpEndpoint: 'http://evil.example/mcp' } },
    })
    expect(res.statusCode).toBe(403)
  })

  it('⑤ 脱敏 GET：source=db、token 只回显尾 4 位、无明文', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/patrol/admin/mcp-config', headers: adminHeader() })
    expect(res.statusCode).toBe(200)
    const j = res.json()
    expect(j.source).toBe('db')
    expect(j.mcpEndpoint).toBe('http://10.233.1.22:8080/mcp-server')
    expect(j.tokenMasked).toBe('••••7654')
    expect(JSON.stringify(j)).not.toContain('sk-patrol-secret-987654')
  })

  it('⑥ 解析链：库 > 环境变量；无库配置时 env 兜底', async () => {
    const { resolvePatrolMcpConfig } = await import('../patrolMcpConfig.js')
    // 库已配置（用例③）→ 库优先
    expect(resolvePatrolMcpConfig().mcpEndpoint).toBe('http://10.233.1.22:8080/mcp-server')
    // 清库 + 设 env → env 兜底
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('api_patrol_mcp_config_v1', { version: 1, mcpEndpoint: '', mcpToken: '' })
    process.env.PATROL_MCP_ENDPOINT = 'http://env-fallback:31788/mcp'
    process.env.PATROL_MCP_TOKEN = 'env-token-xyz'
    const r = resolvePatrolMcpConfig()
    expect(r.mcpEndpoint).toBe('http://env-fallback:31788/mcp')
    expect(r.mcpToken).toBe('env-token-xyz')
    const statusRes = await app.inject({ method: 'GET', url: '/api/patrol/admin/mcp-config', headers: adminHeader() })
    expect(statusRes.json().source).toBe('env')
    delete process.env.PATROL_MCP_ENDPOINT
    delete process.env.PATROL_MCP_TOKEN
  })

  it('⑦ admin/process 不传端点 → 走库配置诊断（真实消费链，mock MCP 断言 Bearer token）', async () => {
    // 库配置指向本地 mock MCP
    const { storageRepository } = await import('../storageRepository.js')
    const cfgEndpoint = `http://127.0.0.1:${mockMcpPort}/mcp`
    storageRepository.putMeta('api_patrol_mcp_config_v1', {
      version: 1, mcpEndpoint: cfgEndpoint, mcpToken: 'patrol-mcp-token-7777',
    })
    // 种一笔失败明细 → 压缩成组
    db.prepare(`
      INSERT INTO api_patrol_requests
        (request_date, pool_name, product_key, request_id, api_path, user_id, user_name, is_success, request_time, created_at)
      VALUES ('2026-09-10', '华南-广州3', 'eip', 'mcp-cfg-rid-1', '/customer/v3/order/create/floatingip', 'u-cfg', 'userCfg', 0, '2026-09-10 10:00:00', 't')
    `).run()
    mockAuthHeaders = []
    const res = await app.inject({
      method: 'POST', url: '/api/patrol/admin/process', headers: adminHeader(),
      payload: { dates: ['2026-09-10'], runDiagnose: true }, // 不传 mcpEndpoint —— 关键：走库配置
    })
    expect(res.statusCode).toBe(200)
    const j = res.json()
    const diagnosedTotal = (j.diagnosed || []).reduce((a, r) => a + r.diagnosed, 0)
    expect(diagnosedTotal).toBeGreaterThan(0)
    // mock MCP 收到的鉴权头 = 库配置的 token
    expect(mockAuthHeaders.length).toBeGreaterThan(0)
    expect(mockAuthHeaders[0]).toBe('Bearer patrol-mcp-token-7777')
    // 组被诊断回填（根因非空）
    const g = db.prepare("SELECT root_cause_l1 l1 FROM api_patrol_failure_groups WHERE first_request_id='mcp-cfg-rid-1'").get()
    expect(g?.l1).toBeTruthy()
  })
})
