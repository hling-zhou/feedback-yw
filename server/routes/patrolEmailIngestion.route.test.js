/**
 * Plan B 邮件拉取路由守卫测试（docs/DESIGN-API巡检.md §9.6）。
 * 覆盖：status/config 脱敏（不含 auth code / imapUser 部分掩码）、
 * 权限（view 可读、manageTags 可写、普通 member 拒绝）、fetch 手动触发、
 * PUT config 审计。路由级测试对齐 patrolMcpConfig.route.test.js 惯例
 * （env 先行 + 动态 import + onRequest 注入 user 不绕过 requirePermission——真走中间件）。
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import JSZip from 'jszip'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-patrol-email-route-'))
process.env.AUTH_DATABASE_PATH = path.join(TMP_DIR, 't.db')
process.env.SERVER_DATA_DIR = TMP_DIR
process.env.JWT_SECRET = 'test-jwt-secret-for-patrol-email-route'
process.env.PATROL_EMAIL_AUTH_CODE = 'route-test-code'

const sqliteMod = await import('../db.js').catch(() => null)
const sqliteAvailable = Boolean(sqliteMod?.getDb)
const { getDb, closeDb } = sqliteAvailable
  ? /** @type {typeof import('../db.js')} */ (sqliteMod)
  : /** @type {any} */ ({})

describe.skipIf(!sqliteAvailable)('Plan B 邮件拉取路由守卫', () => {
  /** @type {import('fastify').FastifyInstance | null} */
  let app = null
  let adminToken = ''
  let editorToken = ''
  let viewerToken = ''
  /** @type {any} */ let ingestionMod = null

  beforeAll(async () => {
    getDb()
    const { initBusinessSchema } = await import('../businessDb.js')
    initBusinessSchema()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({ username: 't_admin', password: 'AdminPass12345!', team: '综合管理组', role: 'admin' })
    const editor = await createUser({ username: 't_editor', password: 'EditorPass12345!', team: '综合管理组', role: 'editor' })
    const viewer = await createUser({ username: 't_viewer', password: 'ViewerPass12345!', team: '综合管理组', role: 'viewer' })
    adminToken = signAccessToken(admin)
    editorToken = signAccessToken(editor)
    viewerToken = signAccessToken(viewer)

    const Fastify = (await import('fastify')).default
    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPatrolEmailIngestionRoutes } = await import('./patrolEmailIngestion.route.js')
    app = Fastify({ logger: false })
    registerAuthHooks(app)
    registerPatrolEmailIngestionRoutes(app)
    await app.ready()

    ingestionMod = await import('../patrolEmailIngestion.js')
    // mock IMAP（空邮件：路由测试不重数据链路）
    ingestionMod.setImapClientFactory(() => ({
      connect: async () => {},
      searchAndFetch: async () => [],
    }))
  })

  afterAll(async () => {
    await app?.close()
    closeDb()
  })

  it('GET status（view）——viewer 可读，含 enabled + 脱敏 state', async () => {
    const res = await app?.inject({ method: 'GET', url: '/api/patrol/email-ingestion/status', headers: { authorization: `Bearer ${viewerToken}` } })
    expect(res?.statusCode).toBe(200)
    const body = res?.json()
    expect(body).toHaveProperty('enabled')
    expect(body).toHaveProperty('state')
    // auth code 不出现在任何响应
    expect(JSON.stringify(body)).not.toContain('route-test-code')
  })

  it('GET config（view）——imapUser 脱敏（z***@域名）+ authCodeConfigured 标志', async () => {
    const res = await app?.inject({ method: 'GET', url: '/api/patrol/email-ingestion/config', headers: { authorization: `Bearer ${viewerToken}` } })
    expect(res?.statusCode).toBe(200)
    const body = res?.json()
    expect(body.imapUser).toMatch(/^z\*{3}@/)
    expect(body.authCodeConfigured).toBe(true)
    expect(JSON.stringify(body)).not.toContain('route-test-code')
    expect(body.senderWhitelist).toContain('service@cmecloud.cn')
  })

  it('PUT config（manageTags）——editor 可改开关并写审计', async () => {
    const res = await app?.inject({
      method: 'PUT', url: '/api/patrol/email-ingestion/config',
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { enabled: true },
    })
    expect(res?.statusCode).toBe(200)
    expect(res?.json().config.enabled).toBe(true)
    // 审计
    const db = getDb()
    const audit = db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='api_patrol.email_ingestion_config_update'").get()
    expect(/** @type {any} */ (audit).c).toBe(1)
    // 回读
    const status = await app?.inject({ method: 'GET', url: '/api/patrol/email-ingestion/status', headers: { authorization: `Bearer ${editorToken}` } })
    expect(status?.json().enabled).toBe(true)
  })

  it('PUT config —— viewer（无 manageTags）被拒', async () => {
    const res = await app?.inject({
      method: 'PUT', url: '/api/patrol/email-ingestion/config',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: { enabled: false },
    })
    expect(res?.statusCode).toBe(403)
  })

  it('POST fetch（manageTags）——editor 手动拉取，no_email 返回 200', async () => {
    const res = await app?.inject({
      method: 'POST', url: '/api/patrol/email-ingestion/fetch',
      headers: { authorization: `Bearer ${editorToken}` },
      payload: { force: true },
    })
    expect(res?.statusCode).toBe(200)
    expect(res?.json().lastResult).toBe('no_email')
  })

  it('POST fetch —— viewer 被拒', async () => {
    const res = await app?.inject({
      method: 'POST', url: '/api/patrol/email-ingestion/fetch',
      headers: { authorization: `Bearer ${viewerToken}` },
      payload: {},
    })
    expect(res?.statusCode).toBe(403)
  })
})
