import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-actions-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-actions-api-xx'
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

const describeActions = sqliteAvailable ? describe : describe.skip

describeActions('actions API (P4-1)', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')

    const viewer = await createUser({
      username: 'actions_viewer',
      password: 'ViewerPass12345!',
      team: '产品运营组',
      role: 'viewer',
    })
    const editor = await createUser({
      username: 'actions_editor',
      password: 'EditorPass12345!',
      team: '产品运营组',
      role: 'editor',
    })
    const admin = await createUser({
      username: 'actions_admin',
      password: 'AdminPass12345!',
      team: '产品运营组',
      role: 'admin',
    })

    tokens = {
      viewer: signAccessToken(viewer),
      editor: signAccessToken(editor),
      admin: signAccessToken(admin),
    }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerActionRoutes } = await import('./actions.js')

    app = Fastify()
    registerAuthHooks(app)
    registerActionRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('viewer can list but not create', async () => {
    const listRes = await app.inject({
      method: 'GET',
      url: '/api/actions',
      headers: authHeader('viewer'),
    })
    expect(listRes.statusCode).toBe(200)
    expect(JSON.parse(listRes.body).items).toEqual([])

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('viewer'), 'content-type': 'application/json' },
      payload: { content: '测试举措' },
    })
    expect(createRes.statusCode).toBe(403)
  })

  it('editor can create, list, and patch action item', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '增加连通性预检',
        productKey: 'vpc',
        productName: '虚拟私有云',
        scheduleAt: '2026-08-01',
        linkedTicketIds: ['C-20260501-001'],
      },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item
    expect(created.content).toBe('增加连通性预检')
    expect(created.status).toBe('in_progress')
    expect(created.linkedTicketIds).toEqual(['C-20260501-001'])
    expect(created.recordRevision).toBe(1)

    const listRes = await app.inject({
      method: 'GET',
      url: '/api/actions?productKey=vpc&ticketId=C-20260501-001',
      headers: authHeader('viewer'),
    })
    expect(listRes.statusCode).toBe(200)
    const listBody = JSON.parse(listRes.body)
    expect(listBody.total).toBe(1)
    expect(listBody.items[0].id).toBe(created.id)

    const statsRes = await app.inject({
      method: 'GET',
      url: '/api/actions/stats',
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(statsRes.body).counts.in_progress).toBe(1)
    const statsBody = JSON.parse(statsRes.body)
    expect(statsBody.byProduct?.length).toBeGreaterThan(0)
    expect(statsBody.byProduct[0].productKey).toBe('vpc')

    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { status: 'completed', scheduleAt: '' },
    })
    expect(patchRes.statusCode).toBe(200)
    const patched = JSON.parse(patchRes.body).item
    expect(patched.status).toBe('completed')

    const deleteRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('editor'),
    })
    expect(deleteRes.statusCode).toBe(403)
  })

  it('rejects empty content on create', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '   ' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('unlink-tickets removes ticket from linkedTicketIds without deleting item', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '共享举措',
        linkedTicketIds: ['T-A', 'T-B'],
      },
    })
    const created = JSON.parse(createRes.body).item

    const unlinkRes = await app.inject({
      method: 'POST',
      url: '/api/actions/unlink-tickets',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { links: [{ actionId: created.id, ticketId: 'T-A' }] },
    })
    expect(unlinkRes.statusCode).toBe(200)
    expect(JSON.parse(unlinkRes.body).updated).toBe(1)

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('viewer'),
    })
    const item = JSON.parse(getRes.body).item
    expect(item.content).toBe('共享举措')
    expect(item.linkedTicketIds).toEqual(['T-B'])
  })

  it('returns 409 when expectedRevision is stale on patch', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '冲突测试举措' },
    })
    const created = JSON.parse(createRes.body).item
    expect(created.recordRevision).toBe(1)

    const staleRes = await app.inject({
      method: 'PATCH',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '过期版本', expectedRevision: 0 },
    })
    expect(staleRes.statusCode).toBe(409)
    const staleBody = JSON.parse(staleRes.body)
    expect(staleBody.code).toBe('ACTION_ITEM_CONFLICT')
    expect(staleBody.currentRevision).toBe(1)

    const okRes = await app.inject({
      method: 'PATCH',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '基于最新保存', expectedRevision: 1 },
    })
    expect(okRes.statusCode).toBe(200)
    expect(JSON.parse(okRes.body).item.recordRevision).toBe(2)
  })

  it('delete clears actionId on records referencing the action', async () => {
    const { storageRepository } = await import('../storageRepository.js')

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '待删除举措' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    storageRepository.putRecord({
      id: 'rec-action-ref',
      ticketId: 'T-REF-1',
      actionId: created.id,
      establishedAction: '待删除举措',
      actionSchedule: '',
      dataSourceType: 'complaint_ticket',
      tenantId: 'default',
      schemaVersion: 1,
      recordStatus: 'analyzed',
    })

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('admin'),
    })
    expect(delRes.statusCode).toBe(200)

    const record = storageRepository.getRecord('rec-action-ref')
    expect(record.actionId).toBe('')
    expect(record.establishedAction).toBe('待删除举措')

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('viewer'),
    })
    expect(getRes.statusCode).toBe(404)
  })

  it('editor cannot delete action items', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '编辑者不可删' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('editor'),
    })
    expect(delRes.statusCode).toBe(403)
  })

  it('admin can delete action linked to feedback tickets (2026-11-25 删除放开)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '已关联反馈',
        linkedTicketIds: ['T-LINK-1'],
        linkedDataSources: ['post_use_rating'],
      },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('admin'),
    })
    expect(delRes.statusCode).toBe(200)

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('viewer'),
    })
    expect(getRes.statusCode).toBe(404)
  })

  it('admin can delete action whose linkedDataSources is set but has no ticket links (误报红证)', async () => {
    // 历史误报形态：linkedDataSources 非空（来源标签）但 linkedTicketIds 为空——
    // 曾被 canDeleteActionItem 拦截并提示「已关联反馈工单，无法删除」而「关联反馈」列为空
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '改善「配额申请与提升」相关问题',
        linkedTicketIds: [],
        linkedDataSources: ['consultation_ticket'],
      },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('admin'),
    })
    expect(delRes.statusCode).toBe(200)
  })

  it('admin can delete action with only requirement ticket links', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '仅需求工单',
        linkedRequirementTicketIds: ['REQ-001'],
      },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('admin'),
    })
    expect(delRes.statusCode).toBe(200)
  })

  it('delete clears promotedTo on observation issues referencing the action (生命周期联动)', async () => {
    const { observationRepository } = await import('../observationRepository.js')

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '留观升级后删除' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    observationRepository.putIssue({
      productKey: 'eip',
      productName: '弹性IP',
      title: '会被升级的留观问题',
      summary: '测试联动清理',
    })
    const issues = observationRepository.listIssues({})
    const issue = issues.issues.find((item) => item.title === '会被升级的留观问题')
    expect(issue).toBeTruthy()
    const db = (await import('../db.js')).getDb()
    // 生产同款写入（observation.js promote 路由）：promotedTo 历史上以 JSON 字符串
    // 形态落库（json_set 字符串参数），测试锚定真实形态验证清理兼容双形态
    db.prepare(
      `UPDATE observation_issues SET status = 'promoted',
       payload = json_set(payload, '$.promotedTo', ?) WHERE id = ?`,
    ).run(
      JSON.stringify({ actionItemId: created.id, promotedAt: new Date().toISOString(), promotedBy: 'admin' }),
      issue.id,
    )
    // 锚定前提：该引用真实存在（防恒绿——清理函数失效时此行先红）
    const before = observationRepository.getIssue(issue.id)
    expect(before?.payload?.promotedTo?.actionItemId).toBe(created.id)

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('admin'),
    })
    expect(delRes.statusCode).toBe(200)

    const after = observationRepository.getIssue(issue.id)
    expect(after?.payload?.promotedTo).toBeUndefined()
  })

  it('delete removes post-use actionIds links on traces/visits (生命周期联动)', async () => {
    const { storageRepository } = await import('../storageRepository.js')
    const { listPostUseActionSources } = await import('../postUseActionService.js')
    const { META_KEY_POST_USE_VISITS } = await import('../../src/lib/postUseRating/visitRecords.js')
    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '被溯源关联后删除', source: 'post_use' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    // importMany 的 fields 白名单不含 actionIds（导入语义），关联走生产方同款 updateActionLink：
    // 先 importMany 落行，再以 add 关联举措（与 importMany 内部 actionsCreated 完成后的形态一致）
    postUseJiraRepository.importMany([{
      itemKey: `pu-link-test-${created.id}`,
      importMonth: '2026-10',
      customerName: '联动测试客户',
      productName: '弹性IP',
      status: '已回复',
      actions: [],
      rowNumber: 1,
    }], { id: 'test-editor', username: 'test-editor' })
    const savedTrace = postUseJiraRepository
      .list({ importMonth: '2026-10' })
      .items.find((item) => item.customerName === '联动测试客户')
    expect(savedTrace?.id).toBeTruthy()
    postUseJiraRepository.updateActionLink(savedTrace.id, created.id, 'add', {
      id: 'test-editor', username: 'test-editor',
    })
    storageRepository.putMeta(META_KEY_POST_USE_VISITS, {
      records: [{
        id: 'visit-link-test-1',
        customerName: '联动测试客户',
        importMonth: '2026-10',
        product: '弹性IP',
        visitResult: '已回访',
        actionIds: [created.id],
      }],
    })

    let sources = listPostUseActionSources(created.id)
    expect(sources.traces.length).toBe(1)
    expect(sources.visits.length).toBe(1)

    const delRes = await app.inject({
      method: 'DELETE',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('admin'),
    })
    expect(delRes.statusCode).toBe(200)

    sources = listPostUseActionSources(created.id)
    expect(sources.traces.length).toBe(0)
    expect(sources.visits.length).toBe(0)
  })

  it('patch rejects updates on locked action items (upsert 导入链路的锁定纪律同权)', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '已锁定举措', status: 'completed', scheduleAt: '' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item

    // 导入 upsert 场景：非空字段才发 patch——锁定后改内容/排期应 400
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { scheduleAt: '2026-12-01' },
    })
    expect(patchRes.statusCode).toBe(400)
    expect(JSON.parse(patchRes.body).error).toContain('已结束')

    // 空列（patch 不发该字段）不影响——只更新 detail 这类非锁定字段可过
    const patchDetailRes = await app.inject({
      method: 'PATCH',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { detail: '补充说明' },
    })
    expect(patchDetailRes.statusCode).toBe(200)
    expect(JSON.parse(patchDetailRes.body).item.detail).toBe('补充说明')
  })

  it('filters action items by problemType and journeyL1 with snapshot and ticket fallback', async () => {
    const { storageRepository } = await import('../storageRepository.js')

    storageRepository.putRecord({
      id: 'rec-filter-a',
      ticketId: 'T-FILTER-A',
      problemType: '故障',
      journeyL1: '使用',
      journeyL2: '监控',
      dataSourceType: 'complaint_ticket',
      tenantId: 'default',
      schemaVersion: 1,
      recordStatus: 'analyzed',
    })
    storageRepository.putRecord({
      id: 'rec-filter-b',
      ticketId: 'T-FILTER-B',
      problemType: '文档自助',
      journeyL1: '了解',
      journeyL2: '产品文档',
      dataSourceType: 'complaint_ticket',
      tenantId: 'default',
      schemaVersion: 1,
      recordStatus: 'analyzed',
    })

    const snapshotRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '快照举措',
        problemTypeSnapshot: '计费与账单',
        journeyL1Snapshot: '开通',
        // 现行语义（bddb061 起）：关联工单的打标优先，快照仅在工单查不到时兜底。
        // 关联一条库中不存在的工单号，走快照兜底路径。
        linkedTicketIds: ['T-FILTER-SNAP'],
      },
    })
    expect(snapshotRes.statusCode).toBe(201)
    const snapshotItem = JSON.parse(snapshotRes.body).item

    const fallbackRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '回退举措',
        linkedTicketIds: ['T-FILTER-B'],
      },
    })
    expect(fallbackRes.statusCode).toBe(201)
    const fallbackItem = JSON.parse(fallbackRes.body).item

    const byProblemSnapshot = await app.inject({
      method: 'GET',
      url: '/api/actions?problemType=%E8%AE%A1%E8%B4%B9%E4%B8%8E%E8%B4%A6%E5%8D%95',
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(byProblemSnapshot.body).total).toBe(1)
    expect(JSON.parse(byProblemSnapshot.body).items[0].id).toBe(snapshotItem.id)

    const byProblemFallback = await app.inject({
      method: 'GET',
      url: '/api/actions?problemType=%E6%96%87%E6%A1%A3%E8%87%AA%E5%8A%A9',
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(byProblemFallback.body).total).toBe(1)
    expect(JSON.parse(byProblemFallback.body).items[0].id).toBe(fallbackItem.id)

    const byJourneySnapshot = await app.inject({
      method: 'GET',
      url: '/api/actions?journeyL1=%E5%BC%80%E9%80%9A',
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(byJourneySnapshot.body).total).toBe(1)
    expect(JSON.parse(byJourneySnapshot.body).items[0].id).toBe(snapshotItem.id)

    const byJourneyFallback = await app.inject({
      method: 'GET',
      url: '/api/actions?journeyL1=%E4%BA%86%E8%A7%A3',
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(byJourneyFallback.body).total).toBe(1)
    expect(JSON.parse(byJourneyFallback.body).items[0].id).toBe(fallbackItem.id)

    const combined = await app.inject({
      method: 'GET',
      url: '/api/actions?problemType=%E6%96%87%E6%A1%A3%E8%87%AA%E5%8A%A9&journeyL1=%E4%BA%86%E8%A7%A3',
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(combined.body).total).toBe(1)
    expect(JSON.parse(combined.body).items[0].id).toBe(fallbackItem.id)
  })

  it('filters action items by linkedDataSources with OR semantics', async () => {
    const complaintRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '投诉来源举措',
        linkedDataSources: ['complaint_ticket'],
      },
    })
    expect(complaintRes.statusCode).toBe(201)
    const complaintItem = JSON.parse(complaintRes.body).item

    const consultationRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '咨询来源举措',
        linkedDataSources: ['consultation_ticket'],
      },
    })
    expect(consultationRes.statusCode).toBe(201)
    const consultationItem = JSON.parse(consultationRes.body).item

    const multiSourceRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '多来源举措',
        linkedDataSources: ['complaint_ticket', 'post_use_rating'],
      },
    })
    expect(multiSourceRes.statusCode).toBe(201)
    const multiSourceItem = JSON.parse(multiSourceRes.body).item

    const byComplaint = await app.inject({
      method: 'GET',
      url: '/api/actions?linkedDataSources=complaint_ticket',
      headers: authHeader('viewer'),
    })
    const complaintIds = JSON.parse(byComplaint.body).items.map((item) => item.id)
    expect(complaintIds).toContain(complaintItem.id)
    expect(complaintIds).toContain(multiSourceItem.id)
    expect(complaintIds).not.toContain(consultationItem.id)

    const byConsultation = await app.inject({
      method: 'GET',
      url: '/api/actions?linkedDataSources=consultation_ticket',
      headers: authHeader('viewer'),
    })
    const consultationIds = JSON.parse(byConsultation.body).items.map((item) => item.id)
    expect(consultationIds).toContain(consultationItem.id)
    expect(consultationIds).not.toContain(complaintItem.id)
    expect(consultationIds).not.toContain(multiSourceItem.id)

    const byMulti = await app.inject({
      method: 'GET',
      url: '/api/actions?linkedDataSources=consultation_ticket,post_use_rating',
      headers: authHeader('viewer'),
    })
    const multiIds = JSON.parse(byMulti.body).items.map((item) => item.id)
    expect(multiIds).toContain(consultationItem.id)
    expect(multiIds).toContain(multiSourceItem.id)
    expect(multiIds).not.toContain(complaintItem.id)
  })

  it('creates and filters api_patrol source items（11-24：schema enum 放行 + 档位过滤）', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: { content: '巡检失败治理举措', source: 'api_patrol' },
    })
    expect(createRes.statusCode).toBe(201)
    const created = JSON.parse(createRes.body).item
    // 归一层不再把 api_patrol 吞回 ticket
    expect(created.source).toBe('api_patrol')

    const bySource = await app.inject({
      method: 'GET',
      url: '/api/actions?source=api_patrol',
      headers: authHeader('viewer'),
    })
    const sourceItems = JSON.parse(bySource.body).items
    expect(sourceItems.some((item) => item.id === created.id)).toBe(true)

    const ticketScope = await app.inject({
      method: 'GET',
      url: '/api/actions?sources=ticket,observation',
      headers: authHeader('viewer'),
    })
    expect(
      JSON.parse(ticketScope.body).items.some((item) => item.id === created.id),
    ).toBe(false)
  })

  it('stats byProduct uses catalog product name instead of stored spec name', async () => {
    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: 'EIP 绑定优化',
        productKey: 'eip',
        productName: '弹性公网IP-移动IP',
        status: 'pending_evaluation',
      },
    })
    expect(createRes.statusCode).toBe(201)

    const statsRes = await app.inject({
      method: 'GET',
      url: '/api/actions/stats?productKey=eip',
      headers: authHeader('viewer'),
    })
    expect(statsRes.statusCode).toBe(200)
    const statsBody = JSON.parse(statsRes.body)
    const eipRow = statsBody.byProduct?.find((row) => row.productKey === 'eip')
    expect(eipRow?.productName).toBe('弹性公网IP')
  })

  it('problem-reduction-view aggregates across-period tickets beyond insight period window', async () => {
    const { storageRepository } = await import('../storageRepository.js')
    await storageRepository.putRecords([
      {
        id: 'rec-pr-a',
        ticketId: 'PR-202605-001',
        dataSourceType: 'complaint_ticket',
        importMonth: '2026-05',
        productKey: 'eip',
        product: '弹性公网IP',
        journeyL1: '资源开通',
        journeyL2: '申请开通',
        problemType: '开通失败',
        sentiment: 'negative',
        painPoint: 'EIP 开通卡在配额校验',
      },
      {
        id: 'rec-pr-b',
        ticketId: 'PR-202609-001',
        dataSourceType: 'consultation_ticket',
        importMonth: '2026-09',
        productKey: 'eip',
        product: '弹性公网IP',
        journeyL1: '资源开通',
        journeyL2: '申请开通',
        problemType: '开通失败',
        sentiment: 'neutral',
        painPoint: '',
      },
      {
        id: 'rec-pr-c',
        ticketId: 'PR-PU-001',
        dataSourceType: 'post_use_rating',
        importMonth: '2026-09',
        productKey: 'eip',
        product: '弹性公网IP',
        journeyL1: '资源开通',
        journeyL2: '申请开通',
        sentiment: 'positive',
        painPoint: '不应该计入问题压降',
      },
    ])

    const createRes = await app.inject({
      method: 'POST',
      url: '/api/actions',
      headers: { ...authHeader('editor'), 'content-type': 'application/json' },
      payload: {
        content: '开通配额预检前置',
        productKey: 'eip',
        productName: '弹性公网IP',
        scheduleAt: '2026-07-01',
        linkedTicketIds: ['PR-202605-001', 'PR-202609-001'],
      },
    })
    expect(createRes.statusCode).toBe(201)

    const res = await app.inject({
      method: 'GET',
      url: '/api/actions/problem-reduction-view',
      headers: authHeader('viewer'),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    const row = body.problems?.find((p) => p.productKey === 'eip')
    expect(row).toBeTruthy()
    // 跨周期（2026-05 与 2026-09）工单都计入：全库聚合不受洞察周期窗口截断
    expect(row.totalTicketCount).toBe(2)
    expect(row.firstMonth).toBe('2026-05')
    expect(row.lastMonth).toBe('2026-09')
    expect(row.monthlyTrend.map((m) => m.date)).toEqual(['2026-05', '2026-09'])
    // post_use_rating 不进问题压降口径
    expect(row.monthlyTrend.every((m) => m.count === 1)).toBe(true)
    // 举措前后对比：锚点月 2026-07 归前段（与服务端同口径）
    expect(row.actions.length).toBe(1)
    expect(row.actions[0].content).toBe('开通配额预检前置')
    expect(row.actions[0].anchorMonth).toBe('2026-07')
    expect(row.actions[0].reduction.beforeMonths.map((m) => m.date)).toEqual(['2026-05'])
    expect(row.actions[0].reduction.afterMonths.map((m) => m.date)).toEqual(['2026-09'])
  })
})
