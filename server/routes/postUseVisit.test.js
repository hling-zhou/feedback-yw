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

  it('marks only changed fields, including the first manual clear, and records the editor', async () => {
    const { storageRepository } = await import('../storageRepository.js')
    const raw = storageRepository.getMeta('post_use_visit_records_v1')
    storageRepository.putMeta('post_use_visit_records_v1', {
      ...raw,
      records: [...raw.records, {
        id: 'visit-manual-diff',
        visitMonth: '2026-11',
        importMonth: '2026-11',
        productName: '云专线',
        customerName: '差异测试客户',
        customerCode: 'DIFF-1',
        internalEvaluationDetail: '',
        internalConclusion: '导入评估',
        assigneeName: '导入经办人',
        remark: '导入备注',
        evaluationSubmitted: true,
        updatedAt: '2026-11-01T00:00:00.000Z',
      }],
    })
    const unchanged = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-manual-diff',
      headers: authHeader('editor'),
      payload: {
        internalEvaluationDetail: '导入评估',
        assigneeName: '导入经办人',
        remark: '导入备注',
        evaluationSubmitted: true,
        baseUpdatedAt: '2026-11-01T00:00:00.000Z',
      },
    })
    expect(unchanged.statusCode).toBe(200)
    expect(unchanged.json().item.manualEditedFields).toBeUndefined()
    expect(unchanged.json().item.updatedAt).toBe('2026-11-01T00:00:00.000Z')

    const cleared = await app.inject({
      method: 'PATCH',
      url: '/api/post-use-visits/visit-manual-diff',
      headers: authHeader('editor'),
      payload: {
        internalEvaluationDetail: '',
        assigneeName: '',
        remark: '导入备注',
        evaluationSubmitted: false,
        baseUpdatedAt: '2026-11-01T00:00:00.000Z',
      },
    })
    expect(cleared.statusCode).toBe(200)
    const item = cleared.json().item
    expect(item.internalEvaluationDetail).toBe('')
    expect(item.assigneeName).toBe('')
    expect(item.remark).toBe('导入备注')
    expect(item.manualEditedFields).toEqual(expect.arrayContaining(['internalEvaluation', 'assigneeName']))
    expect(item.manualEditedFields).not.toContain('remark')
    expect(item.fieldEditMeta.internalEvaluation).toMatchObject({ username: 'visit_editor' })
    expect(item.fieldEditMeta.assigneeName.editedAt).toBeTruthy()
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

  // 2026-11-10 需求：预导入写入（清单导出/发送成功 → 回访 tab 待评估态）+ 幂等
  // 用独立身份（2026-07/云监控/C900）避开 beforeAll 的 visit-abc（2026-09/C001/弹性公网IP）——
  // 身份幂等按三元组判定后会与 beforeAll 老记录互撞（用例耦合教训：构造型用例不与他人共享身份）
  it('batch preload creates pending-visit records idempotently with editRecord permission', async () => {
    const preload = await app.inject({
      method: 'POST',
      url: '/api/post-use-visits/batch',
      headers: authHeader('editor'),
      payload: {
        items: [
          { visitMonth: '2026-07', productName: '云监控', customerName: '客户Z', customerCode: 'C900',
            customerFeedback: '7分以下分布：旧问卷*6分*2次；反馈原因：功能有缺失（2）' },
        ],
      },
    })
    expect(preload.statusCode).toBe(200)
    expect(preload.json().created).toHaveLength(1)
    const created = preload.json().items[0]
    // 预导入态：回访结果/内部评估/经办人为空、评估状态=待评估；客户反馈带入清单行内容（2026-11-10 拍板）
    expect(created.visitResult).toBe('')
    expect(created.internalEvaluationDetail).toBe('')
    expect(created.assigneeName).toBe('')
    expect(created.evaluationSubmitted).toBe(false)
    expect(created.userFeedbackText).toBe('7分以下分布：旧问卷*6分*2次；反馈原因：功能有缺失（2）')

    // 幂等：同身份再预导入不新增（不覆盖首次内容——含客户反馈）
    const again = await app.inject({
      method: 'POST',
      url: '/api/post-use-visits/batch',
      headers: authHeader('editor'),
      payload: {
        items: [
          { visitMonth: '2026-07', productName: '云监控', customerName: '客户Z', customerCode: 'C900',
            customerFeedback: '另一份反馈文本' },
        ],
      },
    })
    expect(again.statusCode).toBe(200)
    expect(again.json().created).toHaveLength(0)
    // 幂等跳过 = 首次客户反馈保留
    const listAfter = await app.inject({
      method: 'GET',
      url: '/api/post-use-visits?importMonth=2026-07',
      headers: authHeader('viewer'),
    })
    const preloaded = listAfter.json().items.find((item) => item.customerCode === 'C900')
    expect(preloaded.userFeedbackText).toBe('7分以下分布：旧问卷*6分*2次；反馈原因：功能有缺失（2）')

    // viewer 403 / 空提交 400
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/post-use-visits/batch',
      headers: authHeader('viewer'),
      payload: { items: [{ visitMonth: '2026-09', productName: 'x', customerName: 'y' }] },
    })
    expect(forbidden.statusCode).toBe(403)
    const empty = await app.inject({
      method: 'POST',
      url: '/api/post-use-visits/batch',
      headers: authHeader('editor'),
      payload: { items: [] },
    })
    expect(empty.statusCode).toBe(400)
  })

  // 2026-11-10 需求③：删除回访 → 联动清 dispatch 已纳入标记 + decisions 勾选重置（editRecord 权限）
  it('delete clears dispatch marks and resets visit decisions with editRecord permission', async () => {
    const { getDb } = await import('../db.js')
    const { postUseVisitDispatchRepository } = await import('../postUseVisitDispatchRepository.js')
    // 造联动前提：预导入记录（独立身份 2026-07/云专线/C901——避开 beforeAll 的 visit-abc/visit-def
    // 与幂等用例的 C900，身份幂等按三元组判定）+ dispatch 标记 + decisions 勾选
    const preload = await app.inject({
      method: 'POST',
      url: '/api/post-use-visits/batch',
      headers: authHeader('editor'),
      payload: { items: [{ visitMonth: '2026-07', productName: '云专线', customerName: '客户Y', customerCode: 'C901' }] },
    })
    expect(preload.statusCode).toBe(200)
    expect(preload.json().created).toHaveLength(1)
    const preloadId = preload.json().created[0]
    postUseVisitDispatchRepository.markMany([
      {
        itemKey: 'q:C901:云专线:2026-07',
        sourceType: 'questionnaire',
        dispatchedVia: 'export',
        customerName: '客户Y',
        productName: '云专线',
        importMonth: '2026-07',
      },
    ])
    getDb()
      .prepare(`INSERT OR REPLACE INTO post_use_callback_decisions (item_key, payload) VALUES (?, ?)`)
      .run(
        'q:C901:云专线:2026-07',
        JSON.stringify({ itemKey: 'q:C901:云专线:2026-07', sourceType: 'questionnaire', needCustomerVisit: true, needInternalTrace: false }),
      )

    // 删除预导入记录（含 viewer 403 验证）
    const forbidden = await app.inject({
      method: 'DELETE',
      url: `/api/post-use-visits/${preloadId}`,
      headers: authHeader('viewer'),
    })
    expect(forbidden.statusCode).toBe(403)

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/post-use-visits/${preloadId}`,
      headers: authHeader('editor'),
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().clearedDispatch).toBe(1)
    expect(res.json().clearedDecisions).toBe(1)

    // dispatch 标记已清、decisions 勾选已重置
    const dispatchLeft = postUseVisitDispatchRepository.list().filter((item) => item.itemKey === 'q:C901:云专线:2026-07')
    expect(dispatchLeft).toHaveLength(0)
    const decisionRow = getDb()
      .prepare(`SELECT payload FROM post_use_callback_decisions WHERE item_key = ?`)
      .get('q:C901:云专线:2026-07')
    expect(JSON.parse(decisionRow.payload).needCustomerVisit).toBe(false)

    // 批量删除（对 visit-abc 原有记录）
    const batch = await app.inject({
      method: 'POST',
      url: '/api/post-use-visits/batch-delete',
      headers: authHeader('editor'),
      payload: { ids: ['visit-abc'] },
    })
    expect(batch.statusCode).toBe(200)
    expect(batch.json().deleted).toBe(1)

    // 404：删除不存在
    const missing = await app.inject({
      method: 'DELETE',
      url: '/api/post-use-visits/visit-missing',
      headers: authHeader('editor'),
    })
    expect(missing.statusCode).toBe(404)
  })
})
