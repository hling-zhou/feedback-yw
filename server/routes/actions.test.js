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

    tokens = {
      viewer: signAccessToken(viewer),
      editor: signAccessToken(editor),
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

  it('editor can create, list, patch, and delete action item', async () => {
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
    expect(deleteRes.statusCode).toBe(200)

    const afterList = await app.inject({
      method: 'GET',
      url: '/api/actions',
      headers: authHeader('viewer'),
    })
    expect(JSON.parse(afterList.body).total).toBe(0)
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
})
