import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-jira-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-post-use-jira-xx'
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

function authHeader(role) {
  return { authorization: `Bearer ${tokens[role]}` }
}

const describeApi = sqliteAvailable ? describe : describe.skip

describeApi('post-use jira API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'jira_editor',
      password: 'EditorPass12345!',
      team: '测试',
      role: 'editor',
    })
    tokens = { editor: signAccessToken(editor) }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPostUseJiraRoutes } = await import('./postUseJira.js')
    app = Fastify()
    registerAuthHooks(app)
    registerPostUseJiraRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
  })

  it('upserts callback decisions and archives jira items without duplicating itemKey', async () => {
    const decisionRes = await app.inject({
      method: 'PUT',
      url: '/api/post-use-callback-decisions',
      headers: authHeader('editor'),
      payload: {
        items: [
          {
            itemKey: 'q:C1:弹性公网IP',
            sourceType: 'questionnaire',
            needCustomerVisit: true,
            needInternalTrace: true,
          },
        ],
      },
    })
    expect(decisionRes.statusCode).toBe(200)
    expect(decisionRes.json().items[0]).toMatchObject({
      itemKey: 'q:C1:弹性公网IP',
      needInternalTrace: true,
    })

    const payload = {
      items: [
        {
          itemKey: 'q:C1:弹性公网IP',
          sourceType: 'questionnaire',
          importMonth: '2026-06',
          customerName: '中国铁塔',
          customerCode: 'C1',
          productName: '弹性公网IP',
          customerFeedback: '7分以下分布：旧问卷*6分*1次',
        },
      ],
    }
    const first = await app.inject({
      method: 'POST',
      url: '/api/post-use-jira',
      headers: authHeader('editor'),
      payload,
    })
    expect(first.statusCode).toBe(200)
    const firstItem = first.json().items[0]
    expect(firstItem.status).toBe('待处理')

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/post-use-jira/${firstItem.id}`,
      headers: authHeader('editor'),
      payload: { jiraTicket: 'JIRA-9', status: '进行中', progress: '已提单', customerName: '黑客' },
    })
    expect(patched.json().item).toMatchObject({
      jiraTicket: 'JIRA-9',
      status: '进行中',
      progress: '已提单',
      customerName: '中国铁塔',
    })

    const second = await app.inject({
      method: 'POST',
      url: '/api/post-use-jira',
      headers: authHeader('editor'),
      payload: {
        items: [
          {
            ...payload.items[0],
            customerFeedback: '更新后的客户反馈',
          },
        ],
      },
    })
    expect(second.statusCode).toBe(200)
    expect(second.json().items).toHaveLength(1)
    expect(second.json().items[0]).toMatchObject({
      id: firstItem.id,
      customerFeedback: '更新后的客户反馈',
      jiraTicket: 'JIRA-9',
      status: '进行中',
      progress: '已提单',
    })

    const listed = await app.inject({
      method: 'GET',
      url: '/api/post-use-jira',
      headers: authHeader('editor'),
    })
    expect(listed.json().total).toBe(1)
  })
})
