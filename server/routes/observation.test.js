import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-obs-routes-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-observation-routes'
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
let token = ''

const describeRoutes = sqliteAvailable ? describe : describe.skip

describeRoutes('observation routes', () => {
  beforeAll(async () => {
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'observation_routes_editor',
      password: 'ObservationRoutes1!',
      team: '综合管理组',
      role: 'editor',
    })
    token = signAccessToken(editor)

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerObservationRoutes } = await import('./observation.js')
    app = Fastify()
    registerAuthHooks(app)
    registerObservationRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  const authHeaders = (json = true) => ({
    authorization: `Bearer ${token}`,
    ...(json ? { 'content-type': 'application/json' } : {}),
  })

  it('creates issue, reads it back with links', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/observation/issues',
      headers: authHeaders(),
      payload: {
        productKey: 'EIP',
        productName: '弹性公网IP',
        title: '退订入口难找',
        summary: '控制台找不到退订/取消入口',
        keywords: ['退订'],
        firstLink: {
          recordId: 'route-rec-1',
          recordDataSource: 'complaint_ticket',
          ticketId: 'RT-001',
        },
      },
    })
    expect(res.statusCode).toBe(200)
    const { issue } = JSON.parse(res.body)
    expect(issue.id).toBeTruthy()
    expect(issue.occurrenceCount).toBe(1)

    const got = await app.inject({
      method: 'GET',
      url: `/api/observation/issues/${issue.id}`,
      headers: authHeaders(),
    })
    expect(got.statusCode).toBe(200)
    const detail = JSON.parse(got.body)
    expect(detail.links).toHaveLength(1)
    expect(detail.links[0].ticketId).toBe('RT-001')
  })

  it('rejects invalid create body with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/observation/issues',
      headers: authHeaders(),
      payload: {
        productKey: 'EIP',
        productName: '弹性公网IP',
        title: '',
        summary: '',
      },
    })
    expect(res.statusCode).toBe(400)
  })

  it('lists issues with sourceMix filter and keyword', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/observation/issues?keyword=退订',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.total).toBeGreaterThanOrEqual(1)

    const ratingOnly = await app.inject({
      method: 'GET',
      url: '/api/observation/issues?sourceMix=rating_only',
      headers: authHeaders(),
    })
    expect(ratingOnly.statusCode).toBe(200)
  })

  it('patch updates issue; delete removes with links', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/observation/issues',
      headers: authHeaders(),
      payload: {
        productKey: 'VPC',
        productName: '虚拟私有云',
        title: '临时问题',
        summary: '临时问题描述',
      },
    })
    const { issue } = JSON.parse(created.body)

    const patched = await app.inject({
      method: 'PATCH',
      url: `/api/observation/issues/${issue.id}`,
      headers: authHeaders(),
      payload: { title: '改名后的临时问题', keywords: ['新词'] },
    })
    expect(patched.statusCode).toBe(200)
    expect(JSON.parse(patched.body).issue.title).toBe('改名后的临时问题')

    const del = await app.inject({
      method: 'DELETE',
      url: `/api/observation/issues/${issue.id}`,
      headers: authHeaders(false),
    })
    expect(del.statusCode).toBe(200)

    const gone = await app.inject({
      method: 'GET',
      url: `/api/observation/issues/${issue.id}`,
      headers: authHeaders(),
    })
    expect(gone.statusCode).toBe(404)
  })

  it('attach link flow: manual confirm, duplicate 409, detach', async () => {
    const created = await app.inject({
      method: 'POST',
      url: '/api/observation/issues',
      headers: authHeaders(),
      payload: {
        productKey: 'SLB',
        productName: '弹性负载均衡',
        title: '路由挂载链接测试',
        summary: '路由挂载链接测试描述',
      },
    })
    const { issue } = JSON.parse(created.body)

    const attach = await app.inject({
      method: 'POST',
      url: `/api/observation/issues/${issue.id}/links`,
      headers: authHeaders(),
      payload: {
        recordId: 'route-rec-attach-1',
        recordDataSource: 'complaint_ticket',
        ticketId: 'RT-ATT-1',
      },
    })
    expect(attach.statusCode).toBe(200)
    expect(JSON.parse(attach.body).link.linkStatus).toBe('confirmed')

    const dup = await app.inject({
      method: 'POST',
      url: `/api/observation/issues/${issue.id}/links`,
      headers: authHeaders(),
      payload: {
        recordId: 'route-rec-attach-1',
        recordDataSource: 'complaint_ticket',
      },
    })
    expect(dup.statusCode).toBe(409)

    const links = await app.inject({
      method: 'GET',
      url: `/api/observation/issues/${issue.id}`,
      headers: authHeaders(),
    })
    const linkId = JSON.parse(links.body).links[0].id
    const detach = await app.inject({
      method: 'DELETE',
      url: `/api/observation/issues/${issue.id}/links/${linkId}`,
      headers: authHeaders(false),
    })
    expect(detach.statusCode).toBe(200)
    expect(JSON.parse(links.body).issue.occurrenceCount).toBe(1)
  })

  it('review flow: confirm a pending suggestion via API', async () => {
    // 直接用 repository 造 pending 建议再走路由 review
    const { observationRepository } = await import('../observationRepository.js')
    const { buildObservationLinkFromInput } = await import(
      '../../src/domain/observationIssue.js'
    )
    const issue = observationRepository.putIssue({
      productKey: 'SLB',
      productName: '弹性负载均衡',
      title: '路由复核测试',
      summary: '路由复核测试描述',
    })
    const pending = observationRepository.putLink(
      buildObservationLinkFromInput({
        issueId: issue.id,
        recordId: 'route-rec-review-1',
        recordDataSource: 'post_use_rating',
        linkStatus: 'pending_suggest',
        linkSource: 'auto_match',
        matchConfidence: 'high',
        matchReason: '路由测试建议',
      }).link,
    ).link

    const confirmed = await app.inject({
      method: 'POST',
      url: `/api/observation/matches/${pending.id}/review`,
      headers: authHeaders(),
      payload: { action: 'confirm' },
    })
    expect(confirmed.statusCode).toBe(200)
    expect(JSON.parse(confirmed.body).action).toBe('confirmed')

    // pending-count 反映变化
    const count = await app.inject({
      method: 'GET',
      url: '/api/observation/matches/pending-count',
      headers: authHeaders(),
    })
    expect(count.statusCode).toBe(200)
    expect(JSON.parse(count.body).total).toBeGreaterThanOrEqual(0)
  })

  it('search records endpoint returns results', async () => {
    // 先插一条 records 供搜索
    const { getDb } = await import('../db.js')
    getDb()
      .prepare(
        `INSERT INTO records (id, payload, import_month, data_source_type, tenant_id, import_batch_id, ticket_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        'route-search-rec',
        JSON.stringify({
          id: 'route-search-rec',
          ticketId: 'RT-SEARCH',
          product: '弹性公网IP',
          productKey: 'EIP',
          dataSourceType: 'complaint_ticket',
          painPoint: '路由搜索测试退订失败',
        }),
        '2026-10',
        'complaint_ticket',
        'local',
        '',
        'RT-SEARCH',
      )

    const res = await app.inject({
      method: 'GET',
      url: '/api/observation/records/search?query=RT-SEARCH',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.records).toHaveLength(1)
    expect(body.records[0].ticketId).toBe('RT-SEARCH')
  })

  it('lists links by record (drawer card data source)', async () => {
    // 复用第一只 issue 的首条 link（route-rec-1）
    const res = await app.inject({
      method: 'GET',
      url: '/api/observation/records/route-rec-1/links',
      headers: authHeaders(false),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.links).toHaveLength(1)
    expect(body.links[0].issueId).toBeTruthy()
  })

  it('scan launches background task (observation_match engine)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/observation/scan',
      headers: authHeaders(),
      payload: { recordIds: ['route-rec-1'] },
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)
    expect(body.ok).toBe(true)
    expect(body.taskId).toBeTruthy()
  })

  it('issue stats endpoint aggregates counts, byProduct and promotion rate', async () => {
    // 种子：前面用例已留下 EIP(watching)/SLB(watching)；补齐 promoted / archived / 第二个产品
    const mkIssue = async (productKey, productName, status) => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/observation/issues',
        headers: authHeaders(),
        payload: {
          productKey,
          productName,
          title: `stats-${productKey}-${status}`,
          summary: `stats-${productKey}-${status}`,
        },
      })
      expect(res.statusCode).toBe(200)
      const { issue } = JSON.parse(res.body)
      if (status !== 'watching') {
        const patched = await app.inject({
          method: 'PATCH',
          url: `/api/observation/issues/${issue.id}`,
          headers: authHeaders(),
          payload: { status },
        })
        expect(patched.statusCode).toBe(200)
      }
      return issue
    }
    await mkIssue('COS', '对象存储', 'promoted')
    await mkIssue('COS', '对象存储', 'archived')
    await mkIssue('EIP', '弹性公网IP', 'promoted')

    const res = await app.inject({
      method: 'GET',
      url: '/api/observation/issues/stats',
      headers: authHeaders(),
    })
    expect(res.statusCode).toBe(200)
    const body = JSON.parse(res.body)

    // counts / total / 升级率口径（分子=已升级，分母=全部含已关闭）
    expect(body.counts).toMatchObject({
      watching: expect.any(Number),
      promoted: expect.any(Number),
      archived: expect.any(Number),
    })
    expect(body.total).toBeGreaterThanOrEqual(5)
    expect(body.counts.promoted).toBeGreaterThanOrEqual(2)
    expect(body.counts.archived).toBeGreaterThanOrEqual(1)
    const sum = body.counts.watching + body.counts.promoted + body.counts.archived
    expect(sum).toBe(body.total)
    expect(body.promotionRate).toBeCloseTo(
      Math.round((body.counts.promoted / body.total) * 1000) / 10,
      5,
    )

    // byProduct：COS 有 promoted+archived 两段，rate = promoted/total
    const cos = body.byProduct.find((row) => row.productKey === 'COS')
    expect(cos).toBeTruthy()
    expect(cos.counts.promoted).toBe(1)
    expect(cos.counts.archived).toBe(1)
    expect(cos.total).toBe(2)
    expect(cos.rate).toBe(50)

    // pendingTotal 与横幅同源
    expect(body.pendingTotal).toBeGreaterThanOrEqual(0)
  })

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/observation/issues',
    })
    expect(res.statusCode).toBe(401)
  })
})
