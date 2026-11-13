import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-actions-api-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-post-use-actions'
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

const describeApi = sqliteAvailable ? describe : describe.skip

describeApi('post-use multiple actions API', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app
  let traceId
  let legacyActionId
  let editorToken
  let viewerToken
  let adminToken

  const editorHeaders = () => ({ authorization: `Bearer ${editorToken}` })
  const viewerHeaders = () => ({ authorization: `Bearer ${viewerToken}` })
  const adminHeaders = () => ({ authorization: `Bearer ${adminToken}` })

  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'action_editor', password: 'EditorPass12345!', team: '产品运营组', role: 'editor',
    })
    const viewer = await createUser({
      username: 'action_viewer', password: 'ViewerPass12345!', team: '产品运营组', role: 'viewer',
    })
    const admin = await createUser({
      username: 'action_admin', password: 'AdminPass12345!', team: '产品运营组', role: 'admin',
    })
    editorToken = signAccessToken(editor)
    viewerToken = signAccessToken(viewer)
    adminToken = signAccessToken(admin)

    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
    traceId = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-C1:云专线:2026-10', importMonth: '2026-10',
      productName: '云专线', customerName: '举措客户A', customerCode: 'ACTION-C1',
    }])[0].id
    const legacyTrace = postUseJiraRepository.archiveMany([{
      itemKey: 'q:ACTION-OLD:云专线:2026-09', importMonth: '2026-09',
      productName: '云专线', customerName: '旧关联客户', customerCode: 'ACTION-OLD',
    }])[0]
    const { validateActionItemCreate } = await import('../../src/domain/actionItem.js')
    const { actionItemRepository } = await import('../actionItemRepository.js')
    const validated = validateActionItemCreate({ content: '旧版回访举措' })
    if (!validated.ok) throw new Error(validated.error)
    const { source: _legacySource, ...legacyItem } = validated.item
    actionItemRepository.putActionItem(legacyItem)
    legacyActionId = legacyItem.id
    postUseJiraRepository.patch(legacyTrace.id, { actionId: legacyActionId })
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('post_use_visit_records_v1', {
      version: 1,
      records: [{
        id: 'action-visit-1', importMonth: '2026-10', visitMonth: '2026-10',
        productName: '云专线', customerName: '举措客户B', customerCode: 'ACTION-C2',
        actionIds: [], actionId: '', updatedAt: '2026-10-01T00:00:00.000Z',
      }],
    })

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPostUseActionRoutes } = await import('./postUseActions.js')
    const { registerActionRoutes } = await import('./actions.js')
    app = Fastify()
    registerAuthHooks(app)
    registerActionRoutes(app)
    registerPostUseActionRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
  })

  it('adds two actions, reuses one on a visit, and removes only one link', async () => {
    const url = `/api/post-use-actions/trace/${traceId}`
    const first = await app.inject({
      method: 'POST', url, headers: editorHeaders(),
      payload: { newAction: { content: '完善开通校验', detail: '补充错误提示' } },
    })
    expect(first.statusCode).toBe(200)
    const firstId = first.json().action.id
    expect(first.json().item.actionIds).toEqual([firstId])
    expect(first.json().item.actionId).toBe(firstId)

    const second = await app.inject({
      method: 'POST', url, headers: editorHeaders(),
      payload: { newAction: { content: '增加告警', scheduleAt: '2026-12-15' } },
    })
    expect(second.statusCode).toBe(200)
    const secondId = second.json().action.id
    expect(second.json().item.actionIds).toEqual([firstId, secondId])
    expect(second.json().item.actionId).toBe(firstId)

    const duplicate = await app.inject({
      method: 'POST', url, headers: editorHeaders(), payload: { actionId: firstId },
    })
    expect(duplicate.statusCode, duplicate.body).toBe(200)
    expect(duplicate.json().item.actionIds).toEqual([firstId, secondId])

    const visit = await app.inject({
      method: 'POST', url: '/api/post-use-actions/visit/action-visit-1',
      headers: editorHeaders(), payload: { actionId: firstId },
    })
    expect(visit.statusCode).toBe(200)
    const visitSecond = await app.inject({
      method: 'POST', url: '/api/post-use-actions/visit/action-visit-1',
      headers: editorHeaders(), payload: { actionId: secondId },
    })
    expect(visitSecond.statusCode).toBe(200)
    expect(visitSecond.json().item.actionIds).toEqual([firstId, secondId])
    expect(visit.json().item).toMatchObject({
      actionIds: [firstId],
      manualEditedFields: expect.arrayContaining(['actionIds']),
      fieldEditMeta: { actionIds: { username: 'action_editor' } },
    })

    const { executeCustomerVisitImport } = await import('../../src/lib/postUseRating/customerVisitImport.js')
    const { storageRepository } = await import('../storageRepository.js')
    await executeCustomerVisitImport({
      adapter: {
        getMeta: async (key) => storageRepository.getMeta(key),
        putMeta: async (key, value) => { storageRepository.putMeta(key, value) },
      },
      rows: [{
        数据月份: '2026-10', 产品名称: '云专线', 客户名称: '举措客户B',
        客户编码: 'ACTION-C2', 回访结果: '重新导入的回访结果',
      }],
      importMonth: '2026-10', libraryRecords: [], updateRecords: async () => {},
    })
    const importedVisit = storageRepository.getMeta('post_use_visit_records_v1').records[0]
    expect(importedVisit.actionIds).toEqual([firstId, secondId])
    expect(importedVisit.fieldEditMeta.actionIds.username).toBe('action_editor')

    const linked = await app.inject({
      method: 'GET', url: `/api/post-use-actions/linked/${firstId}`, headers: viewerHeaders(),
    })
    expect(linked.json().traces.map((item) => item.id)).toContain(traceId)
    expect(linked.json().visits.map((item) => item.id)).toContain('action-visit-1')
    const blockedDelete = await app.inject({
      method: 'DELETE', url: `/api/actions/${firstId}`, headers: adminHeaders(),
    })
    expect(blockedDelete.statusCode).toBe(409)

    const removed = await app.inject({
      method: 'DELETE', url: `${url}/${firstId}`, headers: editorHeaders(),
    })
    expect(removed.statusCode).toBe(200)
    expect(removed.json().item.actionIds).toEqual([secondId])
    const { actionItemRepository } = await import('../actionItemRepository.js')
    expect(actionItemRepository.getActionItem(firstId)?.content).toBe('完善开通校验')
    const after = await app.inject({
      method: 'GET', url: `/api/post-use-actions/linked/${firstId}`, headers: viewerHeaders(),
    })
    expect(after.json().traces).toHaveLength(0)
    expect(after.json().visits).toHaveLength(1)
    const stillBlocked = await app.inject({
      method: 'DELETE', url: `/api/actions/${firstId}`, headers: adminHeaders(),
    })
    expect(stillBlocked.statusCode).toBe(409)

    const visitUrl = '/api/post-use-actions/visit/action-visit-1'
    for (const id of [firstId, secondId]) {
      const unlinked = await app.inject({
        method: 'DELETE', url: `${visitUrl}/${id}`, headers: editorHeaders(),
      })
      expect(unlinked.statusCode).toBe(200)
    }
    const cleared = storageRepository.getMeta('post_use_visit_records_v1').records[0]
    expect(cleared.actionIds).toEqual([])
    expect(cleared.actionId).toBe('')
    await executeCustomerVisitImport({
      adapter: {
        getMeta: async (key) => storageRepository.getMeta(key),
        putMeta: async (key, value) => { storageRepository.putMeta(key, value) },
      },
      rows: [{
        数据月份: '2026-10', 产品名称: '云专线', 客户名称: '举措客户B',
        客户编码: 'ACTION-C2', 回访结果: '再次导入的回访结果',
      }],
      importMonth: '2026-10', libraryRecords: [], updateRecords: async () => {},
    })
    const reimported = storageRepository.getMeta('post_use_visit_records_v1').records[0]
    expect(reimported.actionIds).toEqual([])
    expect(reimported.actionId).toBe('')
    expect(reimported.manualEditedFields).toContain('actionIds')
  })

  it('allows read-only viewing but rejects edits by viewers', async () => {
    const url = `/api/post-use-actions/trace/${traceId}`
    const read = await app.inject({ method: 'GET', url, headers: viewerHeaders() })
    expect(read.statusCode).toBe(200)
    expect(read.json().items).toHaveLength(1)
    const write = await app.inject({
      method: 'POST', url, headers: viewerHeaders(), payload: { newAction: { content: '无权限' } },
    })
    expect(write.statusCode).toBe(403)
  })

  it('migrates legacy single links and restores their post-use source', async () => {
    const { actionItemRepository } = await import('../actionItemRepository.js')
    expect(actionItemRepository.getActionItem(legacyActionId)?.source).toBe('post_use')
    const list = await app.inject({
      method: 'GET', url: '/api/actions?sources=post_use', headers: viewerHeaders(),
    })
    expect(list.statusCode).toBe(200)
    expect(list.json().items.map((item) => item.id)).toContain(legacyActionId)
  })
})
