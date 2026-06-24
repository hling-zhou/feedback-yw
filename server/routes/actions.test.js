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
      team: '测试',
      role: 'viewer',
    })
    const editor = await createUser({
      username: 'actions_editor',
      password: 'EditorPass12345!',
      team: '测试',
      role: 'editor',
    })
    const admin = await createUser({
      username: 'actions_admin',
      password: 'AdminPass12345!',
      team: '测试',
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

  it('admin cannot delete action linked to feedback tickets', async () => {
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
    expect(delRes.statusCode).toBe(409)
    expect(JSON.parse(delRes.body).code).toBe('ACTION_ITEM_DELETE_BLOCKED')

    const getRes = await app.inject({
      method: 'GET',
      url: `/api/actions/${encodeURIComponent(created.id)}`,
      headers: authHeader('viewer'),
    })
    expect(getRes.statusCode).toBe(200)
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
        linkedTicketIds: ['T-FILTER-A'],
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
})
