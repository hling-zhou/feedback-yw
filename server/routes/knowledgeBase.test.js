import { describe, expect, it, vi, beforeEach } from 'vitest'
import { hasPermission } from '../../src/domain/auth/permissions.js'

// 模拟鉴权：按请求头 x-test-role 用真实 hasPermission 判定，默认 admin
vi.mock('../middleware.js', () => ({
  requirePermission: (perm) => async (request, reply) => {
    const role = request.headers['x-test-role'] || 'admin'
    if (!hasPermission(role, perm)) {
      return reply.code(403).send({ error: '无权限执行此操作' })
    }
    request.user = { id: 'u1', username: role }
  },
}))
vi.mock('../knowledgeBaseLoader.js', () => ({
  retrieveSnippets: vi.fn(),
  clearKnowledgeBaseCache: vi.fn(),
}))
vi.mock('../knowledgeBaseRepository.js', () => ({
  listKnowledgeBases: vi.fn(),
  upsertKnowledgeBase: vi.fn(),
  deleteKnowledgeBase: vi.fn(),
}))
vi.mock('../audit.js', () => ({
  logAuditFromRequest: vi.fn(),
}))

import Fastify from 'fastify'
import { registerKnowledgeBaseRoutes } from './knowledgeBase.js'
import { retrieveSnippets, clearKnowledgeBaseCache } from '../knowledgeBaseLoader.js'
import {
  listKnowledgeBases,
  upsertKnowledgeBase,
  deleteKnowledgeBase,
} from '../knowledgeBaseRepository.js'
import { logAuditFromRequest } from '../audit.js'
import { FASTIFY_SCHEMA_OPTIONS } from '../schemas/common.js'
import { registerSchemaErrorHandler } from '../registerSchemaErrorHandler.js'

const ADMIN = { 'x-test-role': 'admin' }
const EDITOR = { 'x-test-role': 'editor' }
const VIEWER = { 'x-test-role': 'viewer' }

describe('knowledgeBase routes', () => {
  /** @type {import('fastify').FastifyInstance} */
  let app

  beforeEach(async () => {
    vi.mocked(retrieveSnippets).mockReset()
    vi.mocked(clearKnowledgeBaseCache).mockReset()
    vi.mocked(listKnowledgeBases).mockReset()
    vi.mocked(upsertKnowledgeBase).mockReset()
    vi.mocked(deleteKnowledgeBase).mockReset()
    vi.mocked(logAuditFromRequest).mockReset()
    app = Fastify({ logger: false, ...FASTIFY_SCHEMA_OPTIONS })
    registerSchemaErrorHandler(app)
    registerKnowledgeBaseRoutes(app)
    await app.ready()
  })

  it('returns merged+deduped snippets per query', async () => {
    vi.mocked(retrieveSnippets).mockImplementation((productKey) => {
      if (productKey === 'eip') {
        return [
          { title: '独享带宽订购', content: '订购流程', productKey: 'eip' },
          { title: '共享带宽', content: '共享带宽池', productKey: 'eip' },
        ]
      }
      if (productKey === 'vpc') {
        return [{ title: '独享带宽订购', content: 'VPC视角', productKey: 'vpc' }]
      }
      return []
    })

    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/retrieve',
      headers: ADMIN,
      body: {
        queries: [
          { productKeys: ['eip', 'vpc'], text: '独享带宽订购失败', tags: ['订购'] },
          { productKeys: ['unknown'], text: 'x', tags: [] },
        ],
      },
    })

    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.results).toHaveLength(2)
    expect(body.results[0]).toHaveLength(3)
    expect(body.results[1]).toEqual([])
    expect(retrieveSnippets).toHaveBeenCalledTimes(3)
  })

  it('handles empty queries array', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/retrieve',
      headers: ADMIN,
      body: { queries: [] },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).results).toEqual([])
  })

  it('returns empty for unknown productKey', async () => {
    vi.mocked(retrieveSnippets).mockReturnValue([])
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/retrieve',
      headers: ADMIN,
      body: { queries: [{ productKeys: ['nope'], text: 'x', tags: [] }] },
    })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).results).toEqual([[]])
  })

  it('rejects retrieve body missing required fields', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/retrieve',
      headers: ADMIN,
      body: { queries: [{ productKeys: ['eip'] }] },
    })
    expect(res.statusCode).toBe(400)
  })

  it('GET /api/knowledge-base lists items (view ok)', async () => {
    vi.mocked(listKnowledgeBases).mockReturnValue([
      { productKey: 'eip', productName: '弹性公网IP', exportDate: '2026-09-04', uploadedByUsername: 'alice', uploadedAt: 't', sizeBytes: 100 },
    ])
    const res = await app.inject({ method: 'GET', url: '/api/knowledge-base', headers: VIEWER })
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(res.body).items).toHaveLength(1)
  })

  it('POST /upload upserts, clears cache, audits (admin)', async () => {
    vi.mocked(upsertKnowledgeBase).mockReturnValue({
      productKey: 'eip', productName: '弹性公网IP', exportDate: '2026-09-04',
      uploadedByUsername: 'admin', uploadedAt: 't', sizeBytes: 200,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/upload',
      headers: ADMIN,
      body: { productLine: 'eip', productName: '弹性公网IP', exportDate: '2026-09-04', details: [{ name: 'f1' }] },
    })
    expect(res.statusCode).toBe(201)
    expect(vi.mocked(upsertKnowledgeBase)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(clearKnowledgeBaseCache)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logAuditFromRequest)).toHaveBeenCalledTimes(1)
    expect(JSON.parse(res.body).item.productKey).toBe('eip')
  })

  it('POST /upload rejects viewer (403)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/upload',
      headers: VIEWER,
      body: { productLine: 'eip', details: [{ name: 'f1' }] },
    })
    expect(res.statusCode).toBe(403)
    expect(vi.mocked(upsertKnowledgeBase)).not.toHaveBeenCalled()
  })

  it('POST /upload allows 体验运营 (editor)', async () => {
    vi.mocked(upsertKnowledgeBase).mockReturnValue({
      productKey: 'eip', productName: '弹性公网IP', exportDate: '2026-09-04',
      uploadedByUsername: 'editor', uploadedAt: 't', sizeBytes: 200,
    })
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/upload',
      headers: EDITOR,
      body: { productLine: 'eip', productName: '弹性公网IP', exportDate: '2026-09-04', details: [{ name: 'f1' }] },
    })
    expect(res.statusCode).toBe(201)
    expect(vi.mocked(upsertKnowledgeBase)).toHaveBeenCalledTimes(1)
  })

  it('POST /upload rejects invalid body (missing details)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/knowledge-base/upload',
      headers: ADMIN,
      body: { productLine: 'eip' },
    })
    expect(res.statusCode).toBe(400)
  })

  it('DELETE /:productKey removes, clears cache, audits (admin)', async () => {
    vi.mocked(deleteKnowledgeBase).mockReturnValue(true)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/knowledge-base/eip',
      headers: ADMIN,
    })
    expect(res.statusCode).toBe(200)
    expect(vi.mocked(deleteKnowledgeBase)).toHaveBeenCalledWith('eip')
    expect(vi.mocked(clearKnowledgeBaseCache)).toHaveBeenCalledTimes(1)
    expect(vi.mocked(logAuditFromRequest)).toHaveBeenCalledTimes(1)
  })

  it('DELETE /:productKey returns 404 when not found', async () => {
    vi.mocked(deleteKnowledgeBase).mockReturnValue(false)
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/knowledge-base/missing',
      headers: ADMIN,
    })
    expect(res.statusCode).toBe(404)
  })

  it('DELETE rejects viewer (403)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/knowledge-base/eip',
      headers: VIEWER,
    })
    expect(res.statusCode).toBe(403)
    expect(vi.mocked(deleteKnowledgeBase)).not.toHaveBeenCalled()
  })
})
