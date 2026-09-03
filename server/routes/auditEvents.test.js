import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'
import { loginBodySchema } from '../schemas/authSchemas.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-audit-events-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-audit-events-xx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'
process.env.AUTO_PUBLISH_CONFIG = 'false'

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

/** @type {import('fastify').FastifyInstance} */
let app
/** @type {Record<string, string>} */
let tokens = {}

function authHeader(role = 'editor') {
  return { authorization: `Bearer ${tokens[role]}` }
}

const sampleRecord = {
  id: 'rec-audit-1',
  dataSourceType: 'complaint_ticket',
  tenantId: 'local',
  schemaVersion: '2',
  recordStatus: 'analyzed',
  importedAt: '2026-05-01T00:00:00.000Z',
  importMonth: '2026-05',
  rawText: '受理内容',
  customerQuote: '',
  requestScene: '报障',
  problemType: '产品功能咨询',
  journeyL1: '使用',
  journeyL2: '监控',
  problemSummary: '痛点',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  sentiment: 'neutral',
  themes: ['监控'],
  status: 'open',
  ticketId: 'T-AUDIT-1',
}

const describeAudit = sqliteAvailable ? describe : describe.skip

describeAudit('audit events for shared writes', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'audit_editor',
      password: 'EditorPass12345!',
      team: '测试',
      role: 'editor',
    })
    const admin = await createUser({
      username: 'audit_admin',
      password: 'AdminPass12345!',
      team: '测试',
      role: 'admin',
    })
    tokens = {
      editor: signAccessToken(editor),
      admin: signAccessToken(admin),
    }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerStorageRoutes } = await import('./storage.js')
    const { registerPostUseJiraRoutes } = await import('./postUseJira.js')
    const { handlePasswordLogin } = await import('../authLogin.js')

    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerAuthHooks(app)
    registerStorageRoutes(app)
    registerPostUseJiraRoutes(app)
    app.post('/api/auth/login', { schema: { body: loginBodySchema } }, handlePasswordLogin)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('writes storage.record_update on PATCH, including forceOverwrite', async () => {
    const first = await app.inject({
      method: 'PATCH',
      url: '/api/storage/records/rec-audit-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: { record: sampleRecord, expectedRevision: 0 },
    })
    expect(first.statusCode).toBe(200)

    const updated = await app.inject({
      method: 'PATCH',
      url: '/api/storage/records/rec-audit-1',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        record: { ...sampleRecord, requestScene: '咨询' },
        expectedRevision: 1,
        forceOverwrite: true,
      },
    })
    expect(updated.statusCode).toBe(200)

    const { listAuditLogs } = await import('../audit.js')
    const entries = listAuditLogs(7)
    const recordUpdates = entries.filter((row) => row.action === 'storage.record_update')
    expect(recordUpdates.length).toBeGreaterThanOrEqual(2)
    const forced = recordUpdates.find((row) => row.detail.forceOverwrite === true)
    expect(forced?.detail.ticketId).toBe('T-AUDIT-1')
    expect(forced?.detail.fields).toContain('requestScene')
    expect(entries.some((row) => row.action === 'storage.record_force_overwrite')).toBe(false)
  })

  it('writes taxonomy_update on putMeta and does not write auto_publish', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/taxonomy_managed',
      headers: { ...authHeader(), 'content-type': 'application/json' },
      payload: {
        value: {
          products: { generic: { key: 'generic', name: '通用', match: [], journeys: [] } },
          sharedProblemTypes: [],
          updatedAt: new Date().toISOString(),
        },
      },
    })
    expect(res.statusCode).toBe(200)

    const { listAuditLogs } = await import('../audit.js')
    const entries = listAuditLogs(7)
    expect(entries.some((row) => row.action === 'storage.taxonomy_update')).toBe(true)
    expect(entries.some((row) => row.action === 'storage.auto_publish_taxonomy')).toBe(false)
  })

  it('writes team_settings_update with changed fields', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/app_settings_shared_v1',
      headers: { ...authHeader('admin'), 'content-type': 'application/json' },
      payload: { value: { useRegex: true, ticketLlmMode: 'off' } },
    })
    expect(res.statusCode).toBe(200)

    const { listAuditLogs } = await import('../audit.js')
    const entry = listAuditLogs(7).find((row) => row.action === 'storage.team_settings_update')
    expect(entry?.detail.key).toBe('app_settings_shared_v1')
    expect(entry?.detail.fields).toEqual(expect.arrayContaining(['useRegex', 'ticketLlmMode']))
  })

  it('writes llm_config_update without key plaintext', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/llm_config_v1',
      headers: { ...authHeader('admin'), 'content-type': 'application/json' },
      payload: { value: { apiKey: 'sk-super-secret', baseUrl: 'https://a/v1', model: 'm1' } },
    })
    expect(res.statusCode).toBe(200)

    const { listAuditLogs } = await import('../audit.js')
    const entry = listAuditLogs(7).find((row) => row.action === 'storage.llm_config_update')
    expect(entry?.detail.key).toBe('llm_config_v1')
    expect(entry?.detail.apiKeyChanged).toBe(true)
    // 不得在审计 detail 中泄露密钥明文
    expect(JSON.stringify(entry?.detail)).not.toContain('sk-super-secret')
  })

  it('writes post_use_callback_decisions.replace', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/post-use-callback-decisions',
      headers: authHeader(),
      payload: {
        items: [
          {
            itemKey: 'q:C-AUDIT:弹性公网IP',
            sourceType: 'questionnaire',
            needCustomerVisit: true,
            needInternalTrace: false,
          },
        ],
      },
    })
    expect(res.statusCode).toBe(200)

    const { listAuditLogs } = await import('../audit.js')
    const entry = listAuditLogs(7).find((row) => row.action === 'post_use_callback_decisions.replace')
    expect(entry?.detail.count).toBe(1)
  })

  it('writes auth.login and auth.login_failed', async () => {
    const failed = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: 'audit_editor', password: 'wrong-password' },
    })
    expect(failed.statusCode).toBe(401)

    const ok = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: { 'content-type': 'application/json' },
      payload: { username: 'audit_editor', password: 'EditorPass12345!' },
    })
    expect(ok.statusCode).toBe(200)

    const { listAuditLogs } = await import('../audit.js')
    const entries = listAuditLogs(7)
    expect(
      entries.some(
        (row) => row.action === 'auth.login_failed' && row.detail.reason === 'invalid_credentials',
      ),
    ).toBe(true)
    expect(entries.some((row) => row.action === 'auth.login' && row.username === 'audit_editor')).toBe(
      true,
    )
  })
})
