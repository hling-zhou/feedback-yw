import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-storage-perm-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-for-storage-perms-xx'
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

const samplePeriod = {
  id: 'period:month:2025-01',
  label: '2025年1月',
  startDate: '2025-01-01',
  endDate: '2025-01-31',
  granularity: 'month',
  anchorYear: 2025,
  anchorMonth: 1,
  status: 'active',
  tenantId: 'local',
  schemaVersion: '2.0',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
}

/** @type {import('fastify').FastifyInstance} */
let app
/** @type {Record<string, string>} */
let tokens = {}

function authHeader(role) {
  return { authorization: `Bearer ${tokens[role]}` }
}

const describeStorage = sqliteAvailable ? describe : describe.skip

describeStorage('storage route permissions', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')

    const viewer = await createUser({
      username: 'perm_viewer',
      password: 'ViewerPass12345',
      team: '测试',
      role: 'viewer',
    })
    const editor = await createUser({
      username: 'perm_editor',
      password: 'EditorPass12345',
      team: '测试',
      role: 'editor',
    })
    const admin = await createUser({
      username: 'perm_admin',
      password: 'AdminPass12345',
      team: '测试',
      role: 'admin',
    })

    tokens = {
      viewer: signAccessToken(viewer),
      editor: signAccessToken(editor),
      admin: signAccessToken(admin),
    }

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerStorageRoutes } = await import('./storage.js')

    app = Fastify()
    registerAuthHooks(app)
    registerStorageRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('viewer can PUT /api/storage/periods (register period metadata for read path)', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/periods',
      headers: authHeader('viewer'),
      payload: { period: samplePeriod },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('viewer can GET /api/storage/records', async () => {
    const adminPut = await app.inject({
      method: 'POST',
      url: '/api/storage/records/batch',
      headers: authHeader('admin'),
      payload: {
        records: [
          {
            id: 'rec-viewer-read-1',
            schemaVersion: '2.0',
            tenantId: 'local',
            dataSourceType: 'complaint_ticket',
            recordStatus: 'analyzed',
            importMonth: '2025-01',
            rawText: '测试',
            customerQuote: '测试',
            importedAt: '2025-01-01T00:00:00.000Z',
          },
        ],
      },
    })
    expect(adminPut.statusCode).toBe(200)

    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records?limit=10&offset=0',
      headers: authHeader('viewer'),
    })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.total).toBeGreaterThanOrEqual(1)
    expect(body.records.some((r) => r.id === 'rec-viewer-read-1')).toBe(true)
  })

  it('editor can PUT /api/storage/periods', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/periods',
      headers: authHeader('editor'),
      payload: { period: samplePeriod },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ok: true })
  })

  it('viewer cannot POST /api/storage/bootstrap-from-local', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/bootstrap-from-local',
      headers: authHeader('viewer'),
      payload: { records: [] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('editor cannot POST /api/storage/bootstrap-from-local', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/bootstrap-from-local',
      headers: authHeader('editor'),
      payload: { records: [] },
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin can POST /api/storage/bootstrap-from-local', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/storage/bootstrap-from-local',
      headers: authHeader('admin'),
      payload: { records: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('viewer cannot PUT team app settings meta', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/app_settings_shared_v1',
      headers: authHeader('viewer'),
      payload: { value: { useRegex: false } },
    })
    expect(res.statusCode).toBe(403)
  })

  it('editor cannot PUT team app settings meta', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/app_settings_shared_v1',
      headers: authHeader('editor'),
      payload: { value: { useRegex: false } },
    })
    expect(res.statusCode).toBe(403)
  })

  it('admin can PUT team app settings meta', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/app_settings_shared_v1',
      headers: authHeader('admin'),
      payload: { value: { useRegex: true, themeMatchMode: 'keyword' } },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('editor can PUT product order volumes meta', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/product_order_volumes_v1',
      headers: authHeader('editor'),
      payload: {
        value: [{ productKey: 'eip', month: '2025-01', orderCount: 100 }],
      },
    })
    expect(res.statusCode).toBe(200)
    expect(res.json().ok).toBe(true)
  })

  it('viewer cannot PUT product order volumes meta', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/api/storage/meta/product_order_volumes_v1',
      headers: authHeader('viewer'),
      payload: {
        value: [{ productKey: 'eip', month: '2025-01', orderCount: 100 }],
      },
    })
    expect(res.statusCode).toBe(403)
  })
})
