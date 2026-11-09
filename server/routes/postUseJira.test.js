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
      team: '产品运营组', // TEAMS 枚举收紧后旧值'测试'会让 createUser 抛错，换合法枚举（修复既有 broken）
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

    // 2026-11-05 状态枚举改名：旧值"进行中"经 normalizePostUseJiraStatus 归一为"处理中"（alias 映射回归）
    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/post-use-jira/${firstItem.id}`,
      headers: authHeader('editor'),
      payload: { jiraTicket: 'JIRA-9', status: '进行中', progress: '已提单', customerName: '黑客' },
    })
    expect(patched.json().item).toMatchObject({
      jiraTicket: 'JIRA-9',
      status: '处理中',
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
      status: '处理中',
      progress: '已提单',
    })

    const listed = await app.inject({
      method: 'GET',
      url: '/api/post-use-jira',
      headers: authHeader('editor'),
    })
    expect(listed.json().total).toBe(1)
  })

  it('需求8：visit dispatch 标记不可逆且幂等（重复标记保留首次时间与来源）', async () => {
    const first = await app.inject({
      method: 'POST',
      url: '/api/post-use-visit-dispatch',
      headers: authHeader('editor'),
      payload: {
        items: [
          {
            itemKey: 'q:C9:弹性公网IP',
            sourceType: 'questionnaire',
            dispatchedVia: 'export',
            customerName: '回访客户甲',
            productName: '弹性公网IP',
            importMonth: '2026-07',
          },
        ],
      },
    })
    expect(first.statusCode).toBe(200)
    expect(first.json().items).toEqual([{ itemKey: 'q:C9:弹性公网IP' }])

    const repeat = await app.inject({
      method: 'POST',
      url: '/api/post-use-visit-dispatch',
      headers: authHeader('editor'),
      payload: {
        items: [
          {
            itemKey: 'q:C9:弹性公网IP',
            sourceType: 'questionnaire',
            dispatchedVia: 'mail', // 换出口再标 → 应被忽略，保留首次 export
          },
        ],
      },
    })
    expect(repeat.statusCode).toBe(200)
    expect(repeat.json().items).toEqual([])

    const listed = await app.inject({
      method: 'GET',
      url: '/api/post-use-visit-dispatch',
      headers: authHeader('editor'),
    })
    expect(listed.json().items).toHaveLength(1)
    expect(listed.json().items[0]).toMatchObject({
      itemKey: 'q:C9:弹性公网IP',
      dispatchedVia: 'export',
    })
    // 保留首次标记时间
    expect(listed.json().items[0].dispatchedAt).toBeTruthy()

    // 空提交 400
    const empty = await app.inject({
      method: 'POST',
      url: '/api/post-use-visit-dispatch',
      headers: authHeader('editor'),
      payload: { items: [] },
    })
    expect(empty.statusCode).toBe(400)
  })

  it('#6 删除归档条目联动取消勾选：同前缀且月份被包含的 trace 勾选置 false，异客户不受影响', async () => {
    // 准备：三个客户的决策——C1 季度键勾选、C1 月子集键勾选、C2 同月勾选（对照组）
    const put = await app.inject({
      method: 'PUT',
      url: '/api/post-use-callback-decisions',
      headers: authHeader('editor'),
      payload: {
        items: [
          { itemKey: 'q:C1:弹性公网IP:2026-08|2026-09', sourceType: 'questionnaire', needInternalTrace: true, needCustomerVisit: true },
          { itemKey: 'q:C1:弹性公网IP:2026-08', sourceType: 'questionnaire', needInternalTrace: true, needCustomerVisit: false },
          { itemKey: 'q:C2:弹性公网IP:2026-08', sourceType: 'questionnaire', needInternalTrace: true, needCustomerVisit: true },
        ],
      },
    })
    expect(put.statusCode).toBe(200)

    // 归档 C1 季度键条目（月份并集 08|09）
    const archived = await app.inject({
      method: 'POST',
      url: '/api/post-use-jira',
      headers: authHeader('editor'),
      payload: {
        items: [
          {
            itemKey: 'q:C1:弹性公网IP:2026-08|2026-09',
            sourceType: 'questionnaire',
            importMonth: '2026-08、2026-09',
            customerName: '客户C1',
            customerCode: 'C1',
            productName: '弹性公网IP',
          },
        ],
      },
    })
    expect(archived.statusCode).toBe(200)
    const archivedItem = archived.json().items[0]

    // 删除该归档条目 → 联动取消勾选
    const deleted = await app.inject({
      method: 'DELETE',
      url: `/api/post-use-jira/${archivedItem.id}`,
      headers: authHeader('editor'),
    })
    expect(deleted.statusCode).toBe(200)

    // 决策读取：C1 两个键的 needInternalTrace 均已置 false（季度键精确命中 + 月子集键被包含命中）
    const decisions = await app.inject({
      method: 'GET',
      url: '/api/post-use-callback-decisions',
      headers: authHeader('editor'),
    })
    const byKey = new Map(decisions.json().items.map((item) => [item.itemKey, item]))
    expect(byKey.get('q:C1:弹性公网IP:2026-08|2026-09')?.needInternalTrace).toBe(false)
    expect(byKey.get('q:C1:弹性公网IP:2026-08')?.needInternalTrace).toBe(false)
    // C2 同月但异前缀 → 不受影响
    expect(byKey.get('q:C2:弹性公网IP:2026-08')?.needInternalTrace).toBe(true)
    // 客服部回访维度不被归档删除触碰
    expect(byKey.get('q:C1:弹性公网IP:2026-08|2026-09')?.needCustomerVisit).toBe(true)
  })

  it('#19 归档即清勾选：archiveMany 后 needInternalTrace 联动置 false（月子集键+needCustomerVisit 不受影响）', async () => {
    // 准备：月键勾选 trace
    const put = await app.inject({
      method: 'PUT',
      url: '/api/post-use-callback-decisions',
      headers: authHeader('editor'),
      payload: {
        items: [
          { itemKey: 'q:C9:云监控:2026-10', sourceType: 'questionnaire', needInternalTrace: true, needCustomerVisit: true },
        ],
      },
    })
    expect(put.statusCode).toBe(200)

    // 归档同前缀季度键条目（月份并集覆盖勾选月）
    const archived = await app.inject({
      method: 'POST',
      url: '/api/post-use-jira',
      headers: authHeader('editor'),
      payload: {
        items: [
          {
            itemKey: 'q:C9:云监控:2026-09|2026-10',
            sourceType: 'questionnaire',
            importMonth: '2026-09、2026-10',
            customerName: '客户C9',
            customerCode: 'C9',
            productName: '云监控',
          },
        ],
      },
    })
    expect(archived.statusCode).toBe(200)

    // 归档后：勾选月(10月)被季度键(09|10)包含 → needInternalTrace 联动清 false
    const decisions = await app.inject({
      method: 'GET',
      url: '/api/post-use-callback-decisions',
      headers: authHeader('editor'),
    })
    const byKey = new Map(decisions.json().items.map((item) => [item.itemKey, item]))
    expect(byKey.get('q:C9:云监控:2026-10')?.needInternalTrace).toBe(false)
    // 客服部回访维度不被归档触碰
    expect(byKey.get('q:C9:云监控:2026-10')?.needCustomerVisit).toBe(true)
  })
})
