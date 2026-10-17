import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import Fastify from 'fastify'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'
import { setMailTransportFactory, resetMailTransportFactory } from '../mail/smtp.js'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-mail-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-mail-api-xx'
process.env.CORS_ORIGINS = 'http://127.0.0.1:5175'

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
/** @type {object[]} */
let sent = []

function authHeader(role) {
  return { authorization: `Bearer ${tokens[role]}` }
}

const describeApi = sqliteAvailable ? describe : describe.skip

describeApi('mail API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const admin = await createUser({
      username: 'mail_admin',
      password: 'AdminPass12345!',
      team: '产品运营组',
      role: 'admin',
    })
    const editor = await createUser({
      username: 'mail_editor',
      password: 'EditorPass12345!',
      team: '产品运营组',
      role: 'editor',
    })
    const viewer = await createUser({
      username: 'mail_viewer',
      password: 'ViewerPass12345!',
      team: '产品运营组',
      role: 'viewer',
    })
    tokens = {
      admin: signAccessToken(admin),
      editor: signAccessToken(editor),
      viewer: signAccessToken(viewer),
    }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerMailRoutes } = await import('./mail.js')
    const { registerSchemaErrorHandler } = await import('../registerSchemaErrorHandler.js')
    app = Fastify({ ...FASTIFY_SCHEMA_OPTIONS })
    registerSchemaErrorHandler(app)
    registerAuthHooks(app)
    registerMailRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    resetMailTransportFactory()
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  beforeEach(async () => {
    sent = []
    setMailTransportFactory(() => ({
      sendMail: async (payload) => {
        sent.push(payload)
        return { messageId: 'test-message' }
      },
    }))
    const { getDb } = await import('../db.js')
    const db = getDb()
    db.exec('DELETE FROM mail_channels')
    db.exec('DELETE FROM mail_recipient_groups')
    db.exec('DELETE FROM mail_templates')
    db.exec("DELETE FROM meta WHERE key = 'mail_public_app_url'")
  })

  it('lists preset templates and omits channel passwords', async () => {
    const create = await app.inject({
      method: 'POST',
      url: '/api/mail/channels',
      headers: authHeader('admin'),
      payload: {
        name: '用后即评',
        dataSourceType: 'post_use_rating',
        host: 'smtp.example.com',
        fromAddress: 'from@example.com',
        password: 'secret-pass',
      },
    })
    expect(create.statusCode).toBe(201)
    expect(create.json().item.password).toBeUndefined()

    const status = await app.inject({
      method: 'GET',
      url: '/api/mail/status',
      headers: authHeader('editor'),
    })
    expect(status.statusCode).toBe(200)
    const body = status.json()
    expect(body.templates.map((item) => item.id)).toEqual(
      expect.arrayContaining(['post_use_report', 'callback_visit_list']),
    )
    expect(body.channels[0]).not.toHaveProperty('password')
    expect(body.channels[0].hasPassword).toBe(true)
    expect(body.groups[0]?.dataSourceType).toBeUndefined()
  })

  it('refuses to delete a preset template and replaces placeholders on send', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/mail/templates/post_use_report',
      headers: authHeader('admin'),
    })
    expect(del.statusCode).toBe(400)

    await app.inject({
      method: 'PUT',
      url: '/api/mail/public-url',
      headers: authHeader('admin'),
      payload: { publicAppUrl: 'https://insights.example.com' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/mail/channels',
      headers: authHeader('admin'),
      payload: {
        name: '用后即评',
        dataSourceType: 'post_use_rating',
        host: 'smtp.postuse.example',
        fromAddress: 'postuse@example.com',
        password: 'post-secret',
      },
    })
    await app.inject({
      method: 'POST',
      url: '/api/mail/channels',
      headers: authHeader('admin'),
      payload: {
        name: '投诉',
        dataSourceType: 'complaint_ticket',
        host: 'smtp.complaint.example',
        fromAddress: 'complaint@example.com',
        password: 'complaint-secret',
      },
    })
    const custom = await app.inject({
      method: 'POST',
      url: '/api/mail/templates',
      headers: authHeader('admin'),
      payload: {
        name: '自定义',
        subject: '自定义 {周期键}',
        body: '{周期标签} {月报|季报} {绝对链接}',
      },
    })
    expect(custom.statusCode).toBe(201)
    const templateId = custom.json().item.id

    const send = await app.inject({
      method: 'POST',
      url: '/api/mail/send',
      headers: authHeader('editor'),
      payload: {
        templateId,
        dataSourceType: 'post_use_rating',
        periodLabel: '2026年6月',
        reportKey: '2026-06',
        reportKind: 'month',
        linkKind: 'report',
        to: ['ops@example.com'],
        attachment: {
          filename: '用后即评月报-2026-06.html',
          mime: 'text/html;charset=utf-8',
          contentBase64: Buffer.from('<html>report</html>').toString('base64'),
        },
      },
    })
    expect(send.statusCode).toBe(200)
    expect(sent).toHaveLength(1)
    expect(sent[0].from).toBe('postuse@example.com')
    expect(sent[0].subject).toBe('自定义 2026-06')
    expect(sent[0].text).toContain('2026年6月 月报 https://insights.example.com/workbench/post-use-report/2026-06')
    expect(sent[0].attachments[0].filename).toBe('用后即评月报-2026-06.html')
  })

  it('keeps the report attachment when sending with the callback template', async () => {
    await app.inject({
      method: 'PUT',
      url: '/api/mail/public-url',
      headers: authHeader('admin'),
      payload: { publicAppUrl: 'https://insights.example.com' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/mail/channels',
      headers: authHeader('admin'),
      payload: {
        name: '用后即评',
        dataSourceType: 'post_use_rating',
        host: 'smtp.example.com',
        fromAddress: 'from@example.com',
      },
    })
    const send = await app.inject({
      method: 'POST',
      url: '/api/mail/send',
      headers: authHeader('editor'),
      payload: {
        templateId: 'callback_visit_list',
        dataSourceType: 'post_use_rating',
        periodLabel: '2026年6月',
        reportKey: '2026-06',
        reportKind: 'month',
        linkKind: 'report',
        to: ['ops@example.com'],
        attachment: {
          filename: '用后即评月报-2026-06.html',
          mime: 'text/html;charset=utf-8',
          contentBase64: Buffer.from('<html>still-html</html>').toString('base64'),
        },
      },
    })
    expect(send.statusCode).toBe(200)
    expect(sent[0].attachments[0].filename).toMatch(/\.html$/)
    expect(sent[0].text).toContain('/workbench/post-use-report/2026-06')
  })

  it('returns 503 without a public URL or post-use channel, and 403 for viewers', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/mail/send',
      headers: authHeader('editor'),
      payload: {
        templateId: 'post_use_report',
        dataSourceType: 'post_use_rating',
        linkKind: 'report',
        to: ['ops@example.com'],
        attachment: {
          filename: 'a.html',
          mime: 'text/html',
          contentBase64: Buffer.from('a').toString('base64'),
        },
      },
    })
    expect(missing.statusCode).toBe(503)

    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/mail/channels',
      headers: authHeader('viewer'),
      payload: {
        name: 'x',
        dataSourceType: 'post_use_rating',
        host: 'smtp.example.com',
        fromAddress: 'from@example.com',
      },
    })
    expect(forbidden.statusCode).toBe(403)
  })

  it('returns the SMTP failure reason instead of a generic 发送失败', async () => {
    setMailTransportFactory(() => ({
      sendMail: async () => {
        const err = new Error('Invalid login')
        err.code = 'EAUTH'
        err.response = '535 5.7.8 Error: authentication failed'
        throw err
      },
    }))
    await app.inject({
      method: 'PUT',
      url: '/api/mail/public-url',
      headers: authHeader('admin'),
      payload: { publicAppUrl: 'https://insights.example.com' },
    })
    await app.inject({
      method: 'POST',
      url: '/api/mail/channels',
      headers: authHeader('admin'),
      payload: {
        name: '用后即评',
        dataSourceType: 'post_use_rating',
        host: 'smtp.example.com',
        fromAddress: 'from@example.com',
        password: 'secret',
      },
    })
    const send = await app.inject({
      method: 'POST',
      url: '/api/mail/send',
      headers: authHeader('editor'),
      payload: {
        templateId: 'post_use_report',
        dataSourceType: 'post_use_rating',
        linkKind: 'report',
        reportKey: '2026-06',
        to: ['ops@example.com'],
        attachment: {
          filename: 'a.html',
          mime: 'text/html',
          contentBase64: Buffer.from('a').toString('base64'),
        },
      },
    })
    expect(send.statusCode).toBe(502)
    expect(send.json().error).toBe('SMTP 认证失败：535 5.7.8 Error: authentication failed')
  })
})
