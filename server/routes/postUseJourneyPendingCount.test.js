import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-journey-count-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-post-use-journey-xx'
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

const period = {
  id: 'period:month:2026-06',
  label: '2026年6月',
  startDate: '2026-06-01',
  endDate: '2026-06-30',
  granularity: 'month',
  anchorYear: 2026,
  anchorMonth: 6,
  status: 'active',
  tenantId: 'local',
  schemaVersion: '2.0',
  createdAt: '2026-06-01T00:00:00.000Z',
  updatedAt: '2026-06-01T00:00:00.000Z',
}

function ratingRecord(id, overrides = {}) {
  return {
    id,
    dataSourceType: 'post_use_rating',
    tenantId: 'local',
    schemaVersion: '2',
    recordStatus: 'analyzed',
    importedAt: '2026-06-01T00:00:00.000Z',
    importMonth: '2026-06',
    productName: '弹性公网IP',
    channel: 'sms',
    ratingScore: 8,
    ...overrides,
  }
}

/** @type {import('fastify').FastifyInstance} */
let app
let token = ''

const describeCount = sqliteAvailable ? describe : describe.skip

describeCount('GET /api/storage/records/post-use-journey/pending-count', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()

    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'post_use_journey_count_editor',
      password: 'EditorPass12345!',
      team: '产品运营组',
      role: 'editor',
    })
    token = signAccessToken(editor)

    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putInsightPeriod(period)
    storageRepository.putMeta('product_catalog_managed_v1', {
      version: 1,
      updatedAt: '2026-06-01T00:00:00.000Z',
      products: [
        {
          key: 'eip',
          name: '弹性公网IP',
          enabled: true,
          analysisPostUseRating: true,
          taxonomyKey: 'eip',
          acceptParentName: true,
          specs: [],
        },
        {
          key: 'ecs',
          name: '云主机',
          enabled: true,
          analysisPostUseRating: false,
          taxonomyKey: 'ecs',
          acceptParentName: true,
          specs: [],
        },
      ],
      deletedKeys: [],
      disabledAnalysisKeys: [],
    })

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerStorageRoutes } = await import('./storage.js')
    app = Fastify()
    registerAuthHooks(app)
    registerStorageRoutes(app)
    await app.ready()

    await app.inject({
      method: 'POST',
      url: '/api/storage/records/batch',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: {
        records: [
          ratingRecord('eip-pending'),
          ratingRecord('eip-tagged', { journeyL1: '使用', journeySource: 'llm' }),
          ratingRecord('ecs-pending', { productName: '云主机' }),
          ratingRecord('eip-callback', { channel: 'callback' }),
        ],
      },
    })
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('exposes the count route and only includes analysis-enabled library records', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/storage/records/post-use-journey/pending-count?periodId=period:month:2026-06',
      headers: { authorization: `Bearer ${token}` },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.count).toBe(1)
    expect(body.recordIds).toEqual(['eip-pending'])
  })
})
