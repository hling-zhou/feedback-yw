import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-visit-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-post-use-visit-xx'
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

describeApi('post-use visit API', () => {
  // CI/沙箱环境下动态 import 链路较慢（每个模块加载可达数十秒），放宽 beforeAll 超时
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'visit_editor',
      password: 'EditorPass12345!',
      team: '产品运营组',
      role: 'editor',
    })
    const viewer = await createUser({
      username: 'visit_viewer',
      password: 'ViewerPass12345!',
      team: '产品运营组',
      role: 'viewer',
    })
    tokens = { editor: signAccessToken(editor), viewer: signAccessToken(viewer) }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPostUseVisitRoutes } = await import('./postUseVisit.js')
    app = Fastify()
    registerAuthHooks(app)
    registerPostUseVisitRoutes(app)
    await app.ready()

    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('post_use_visit_records_v1', {
      version: 1,
      updatedAt: new Date().toISOString(),
      records: [
        {
          id: 'visit-abc',
          visitMonth: '2026-09',
          importMonth: '2026-09',
          productName: '弹性公网IP',
          customerName: '客户A',
          customerCode: 'C001',
          visitResult: '客户表示理解',
          internalConclusion: '暂不处理',
          internalEvaluationDetail: '暂不处理',
          remark: '',
          updatedAt: '2026-09-01T00:00:00.000Z',
        },
        {
          id: 'visit-def',
          visitMonth: '2026-08',
          importMonth: '2026-08',
          productName: '云主机',
          customerName: '客户B',
          customerCode: 'C002',
          visitResult: '已解决',
          internalConclusion: '',
          internalEvaluationDetail: '',
          remark: '',
          updatedAt: '2026-08-01T00:00:00.000Z',
        },
      ],
    })

    // 挂接 visit-abc 的用后即评明细（customerVisit 快照），用于验证编辑后回写
    storageRepository.putRecord({
      id: 'rating-001',
      importMonth: '2026-09',
      dataSourceType: 'post_use_rating',
      productName: '弹性公网IP',
      customerName: '客户A',
      customerCode: 'C001',
      ratingScore: 6,
      commentText: '带宽不稳定',
      customerVisit: {
        visitMonth: '2026-09',
        importMonth: '2026-09',
        productName: '弹性公网IP',
        customerName: '客户A',
        customerCode: 'C001',
        visitResult: '客户表示理解',
        internalConclusion: '暂不处理',
        internalEvaluationDetail: '暂不处理',
        remark: '',
      },
    })
  }, 300000)

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
  })

  it('lists visits and filters by multi-month importMonth', async () => {
    const all = await app.inject({
      method: 'GET',
      url: '/api/post-use-visits',
      headers: authHeader('viewer'),
    })
    expect(all.statusCode).toBe(200)
    expect(all.json().items.length).toBe(2)

    const filtered = await app.inject({
      method: 'GET',
      url: '/api/post-use-visits?importMonth=2026-09%E3%80%812026-10',
      headers: authHeader('viewer'),
    })
    expect(filtered.statusCode).toBe(200)
    const items = filtered.json().items
    expect(items.length).toBe(1)
    expect(items[0].id).toBe('visit-abc')
  })

  it('patches internal evaluation and remark with editRecord permission', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-abc',
      headers: authHeader('editor'),
      payload: {
        internalEvaluationDetail: '综合评估后暂不处理',
        remark: '客户为误操作',
        baseUpdatedAt: '2026-09-01T00:00:00.000Z',
      },
    })
    expect(res.statusCode).toBe(200)
    const item = res.json().item
    expect(item.internalEvaluationDetail).toBe('综合评估后暂不处理')
    expect(item.internalConclusion).toBe('综合评估后暂不处理')
    expect(item.remark).toBe('客户为误操作')
    expect(item.updatedAt).not.toBe('2026-09-01T00:00:00.000Z')
  })

  it('2026-11-05 评估状态流转：evaluationSubmitted 提交往返 + 暂存回退（服务端持久化验证）', async () => {
    // visit-def 评估为空（待评估）→ 暂存（evaluationSubmitted=false + 评估草稿）→ 读回评估中
    const draft = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-def',
      headers: authHeader('editor'),
      payload: {
        internalEvaluationDetail: '草稿：疑似误操作',
        evaluationSubmitted: false,
      },
    })
    expect(draft.statusCode).toBe(200)
    expect(draft.json().item.evaluationSubmitted).toBe(false)
    expect(draft.json().item.internalEvaluationDetail).toBe('草稿：疑似误操作')

    // 提交（evaluationSubmitted=true）→ 读回已评估
    const submit = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-def',
      headers: authHeader('editor'),
      payload: {
        internalEvaluationDetail: '确认误操作，无需优化',
        evaluationSubmitted: true,
      },
    })
    expect(submit.statusCode).toBe(200)
    expect(submit.json().item.evaluationSubmitted).toBe(true)

    // GET 列表读回持久化值（meta 真实写盘验证，非仅响应回显）
    const list = await app.inject({
      method: 'GET',
      url: '/api/post-use-visits?importMonth=2026-08',
      headers: authHeader('viewer'),
    })
    expect(list.statusCode).toBe(200)
    const persisted = list.json().items.find((v) => v.id === 'visit-def')
    expect(persisted.evaluationSubmitted).toBe(true)
    expect(persisted.internalEvaluationDetail).toBe('确认误操作，无需优化')

    // 提交后发现需补充 → 暂存回退为评估中（false 可再次写入，覆盖 true）
    const revert = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-def',
      headers: authHeader('editor'),
      payload: { evaluationSubmitted: false },
    })
    expect(revert.statusCode).toBe(200)
    expect(revert.json().item.evaluationSubmitted).toBe(false)
  })

  it('syncs customerVisit snapshot on records after editing the visit', async () => {
    // 先把 visit-def 的内部评估/备注写入一条（快照回写需先有编辑前值）
    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-def',
      headers: authHeader('editor'),
      payload: {
        internalEvaluationDetail: '旧评估',
        remark: '旧备注',
      },
    })
    expect(patchRes.statusCode).toBe(200)

    const { storageRepository } = await import('../storageRepository.js')
    // 挂接 visit-def 的记录（customerVisit 快照与编辑前值一致）
    storageRepository.putRecord({
      id: 'rating-002',
      importMonth: '2026-08',
      dataSourceType: 'post_use_rating',
      productName: '云主机',
      customerName: '客户B',
      customerCode: 'C002',
      ratingScore: 8,
      commentText: '整体可用',
      customerVisit: {
        visitMonth: '2026-08',
        importMonth: '2026-08',
        productName: '云主机',
        customerName: '客户B',
        customerCode: 'C002',
        visitResult: '已解决',
        internalConclusion: '旧评估',
        internalEvaluationDetail: '旧评估',
        remark: '旧备注',
      },
    })

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-def',
      headers: authHeader('editor'),
      payload: {
        internalEvaluationDetail: '新评估',
        remark: '新备注',
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().syncedSnapshots).toBe(1)

    const updated = storageRepository.getRecord('rating-002')
    expect(updated.customerVisit.internalEvaluationDetail).toBe('新评估')
    expect(updated.customerVisit.internalConclusion).toBe('新评估')
    expect(updated.customerVisit.remark).toBe('新备注')
  })

  it('returns 409 when baseUpdatedAt mismatches', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-abc',
      headers: authHeader('editor'),
      payload: {
        remark: 'stale write',
        baseUpdatedAt: '2020-01-01T00:00:00.000Z',
      },
    })
    expect(res.statusCode).toBe(409)
  })

  it('returns 404 for unknown id and 403 for viewer role', async () => {
    const notFound = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-missing',
      headers: authHeader('editor'),
      payload: { remark: 'x' },
    })
    expect(notFound.statusCode).toBe(404)

    const forbidden = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-abc',
      headers: authHeader('viewer'),
      payload: { remark: 'x' },
    })
    expect(forbidden.statusCode).toBe(403)
  })
})
