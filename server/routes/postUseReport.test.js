import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import Fastify from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-report-'))
process.env.AUTH_DATABASE_PATH = path.join(tmpDir, 'test.db')
process.env.SERVER_DATA_DIR = tmpDir
process.env.JWT_SECRET = 'test-jwt-secret-post-use-report-xx'

describe('post use report issue association API', () => {
  let app
  let editorAuth
  let viewerAuth

  beforeAll(async () => {
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPostUseReportRoutes } = await import('./postUseReport.js')
    const editor = await createUser({ username: 'report_editor', password: 'EditorPass12345!', team: '综合管理组', role: 'editor' })
    const viewer = await createUser({ username: 'report_viewer', password: 'ViewerPass12345!', team: '综合管理组', role: 'viewer' })
    editorAuth = { authorization: `Bearer ${signAccessToken(editor)}` }
    viewerAuth = { authorization: `Bearer ${signAccessToken(viewer)}` }
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putRecords([{
      id: 'rating-report-route', dataSourceType: 'post_use_rating', importMonth: '2026-06',
      product: '弹性公网IP', customerCode: 'REPORT-C1', customerName: '客户甲',
      channel: 'console', ratingScore: 2,
      feedbackReasonTexts: ['功能有缺失；页面打开慢'],
    }])
    storageRepository.putMeta('post_use_visit_records_v1', { records: [{
      id: 'visit-report-route', importMonth: '2026-06', productName: '弹性公网IP',
      customerCode: 'REPORT-C1', customerName: '客户甲',
      userFeedbackText: '功能有缺失；页面打开慢', visitResult: '无问题',
    }] })
    app = Fastify()
    registerAuthHooks(app)
    registerPostUseReportRoutes(app)
    await app.ready()
  })

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('offers two exact issue candidates, requires edit permission and invalidates changed visit results', async () => {
    const url = '/api/post-use-report/source-issues?sourceType=visit&sourceId=visit-report-route'
    const candidates = await app.inject({ method: 'GET', url, headers: editorAuth })
    expect(candidates.statusCode).toBe(200)
    expect(candidates.json().items.map((row) => row.issueName)).toEqual(['功能有缺失', '页面打开慢'])
    const issueId = candidates.json().items[0].id
    const payload = { issueId, sourceType: 'visit', sourceId: 'visit-report-route', verdict: 'no_issue' }
    const denied = await app.inject({ method: 'PUT', url: '/api/post-use-report/links', headers: viewerAuth, payload })
    expect(denied.statusCode).toBe(403)
    const saved = await app.inject({ method: 'PUT', url: '/api/post-use-report/links', headers: editorAuth, payload })
    expect(saved.statusCode).toBe(200)
    const linked = await app.inject({ method: 'GET', url, headers: editorAuth })
    expect(linked.json().links).toHaveLength(1)
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('post_use_visit_records_v1', { records: [{
      id: 'visit-report-route', importMonth: '2026-06', productName: '弹性公网IP',
      customerCode: 'REPORT-C1', customerName: '客户甲', userFeedbackText: '功能有缺失；页面打开慢',
      visitResult: '仍有问题',
    }] })
    const changed = await app.inject({ method: 'GET', url, headers: editorAuth })
    expect(changed.json().links).toEqual([])
    const rejected = await app.inject({ method: 'PUT', url: '/api/post-use-report/links', headers: editorAuth, payload })
    expect(rejected.statusCode).toBe(400)
  })
})
