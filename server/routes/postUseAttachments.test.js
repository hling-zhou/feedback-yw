import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import Fastify from 'fastify'

const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fi-post-use-attachments-'))
process.env.AUTH_DATABASE_PATH = path.join(tempDir, 'test.db')
process.env.SERVER_DATA_DIR = tempDir
process.env.JWT_SECRET = 'test-jwt-secret-for-post-use-attachments'
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
let traceId = ''
const visitId = 'attachment-visit-1'
const authHeader = (role) => ({ authorization: 'Bearer ' + tokens[role] })
const describeApi = sqliteAvailable ? describe : describe.skip

describeApi('post-use attachments API', () => {
  beforeAll(async () => {
    const { closeDb, getDb } = await import('../db.js')
    closeDb()
    getDb()
    const { createUser } = await import('../users.js')
    const { signAccessToken } = await import('../auth.js')
    const editor = await createUser({
      username: 'attachment_editor',
      password: 'EditorPass12345!',
      team: '产品运营组',
      role: 'editor',
    })
    const viewer = await createUser({
      username: 'attachment_viewer',
      password: 'ViewerPass12345!',
      team: '产品运营组',
      role: 'viewer',
    })
    tokens = { editor: signAccessToken(editor), viewer: signAccessToken(viewer) }

    const { postUseJiraRepository } = await import('../postUseJiraRepository.js')
    traceId = postUseJiraRepository.archiveMany([{
      itemKey: 'q:attachment-customer:云专线:2026-11',
      importMonth: '2026-11',
      customerName: '附件测试客户',
      productName: '云专线',
    }])[0].id
    const { storageRepository } = await import('../storageRepository.js')
    storageRepository.putMeta('post_use_visit_records_v1', {
      version: 1,
      records: [{
        id: visitId,
        visitMonth: '2026-11',
        importMonth: '2026-11',
        productName: '云专线',
        customerName: '附件测试客户',
        customerCode: 'ATTACH-1',
        updatedAt: new Date().toISOString(),
      }],
    })

    const { registerAuthHooks } = await import('../middleware.js')
    const { registerPostUseAttachmentRoutes } = await import('./postUseAttachments.js')
    const { registerPostUseJiraRoutes } = await import('./postUseJira.js')
    const { registerPostUseVisitRoutes } = await import('./postUseVisit.js')
    app = Fastify()
    registerAuthHooks(app)
    registerPostUseAttachmentRoutes(app)
    registerPostUseJiraRoutes(app)
    registerPostUseVisitRoutes(app)
    await app.ready()
  }, 300000)

  afterAll(async () => {
    await app?.close()
    const { closeDb } = await import('../db.js')
    closeDb()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('uploads a file larger than the proxy request limit in chunks and cleans it on trace deletion', async () => {
    const source = Buffer.alloc(21 * 1024 * 1024, 65)
    source.write('%PDF-1.7\n', 0, 'ascii')
    const start = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/trace/' + traceId + '/uploads',
      headers: authHeader('editor'),
      payload: { filename: '溯源材料.pdf', sizeBytes: source.length },
    })
    expect(start.statusCode).toBe(200)
    const { id, chunkBytes } = start.json()
    expect(chunkBytes).toBe(4 * 1024 * 1024)
    for (let index = 0, offset = 0; offset < source.length; index += 1, offset += chunkBytes) {
      const chunk = await app.inject({
        method: 'PUT',
        url: '/api/post-use-attachments/uploads/' + id + '/chunks/' + index,
        headers: { ...authHeader('editor'), 'content-type': 'application/octet-stream' },
        payload: source.subarray(offset, offset + chunkBytes),
      })
      expect(chunk.statusCode).toBe(200)
    }
    const completed = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/uploads/' + id + '/complete',
      headers: authHeader('editor'),
    })
    expect(completed.statusCode).toBe(200)
    expect(completed.json().item).toMatchObject({
      id, filename: '溯源材料.pdf', sizeBytes: source.length, previewable: true,
    })
    const { getAttachment, getAttachmentFilePath } = await import('../postUseAttachmentRepository.js')
    const file = getAttachmentFilePath(id)
    expect(fs.statSync(file).size).toBe(source.length)

    const listing = await app.inject({
      method: 'GET',
      url: '/api/post-use-attachments/trace/' + traceId,
      headers: authHeader('viewer'),
    })
    expect(listing.statusCode).toBe(200)
    expect(listing.json().total).toBe(1)
    const forbidden = await app.inject({
      method: 'DELETE',
      url: '/api/post-use-attachments/files/' + id,
      headers: authHeader('viewer'),
    })
    expect(forbidden.statusCode).toBe(403)

    const deletedTrace = await app.inject({
      method: 'DELETE',
      url: '/api/post-use-jira/' + traceId,
      headers: authHeader('editor'),
    })
    expect(deletedTrace.statusCode).toBe(200)
    expect(getAttachment(id)).toBeNull()
    expect(fs.existsSync(file)).toBe(false)
  }, 300000)

  it('validates type, supports download, and deletes visit attachments', async () => {
    const viewerUpload = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/visit/' + visitId + '/uploads',
      headers: authHeader('viewer'),
      payload: { filename: '回访.csv', sizeBytes: 4 },
    })
    expect(viewerUpload.statusCode).toBe(403)
    const badType = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/visit/' + visitId + '/uploads',
      headers: authHeader('editor'),
      payload: { filename: 'script.exe', sizeBytes: 4 },
    })
    expect(badType.statusCode).toBe(400)

    const data = Buffer.from('a,b\n1,2\n')
    const start = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/visit/' + visitId + '/uploads',
      headers: authHeader('editor'),
      payload: { filename: '回访.csv', sizeBytes: data.length },
    })
    expect(start.statusCode).toBe(200)
    const uploaded = await app.inject({
      method: 'PUT',
      url: '/api/post-use-attachments/uploads/' + start.json().id + '/chunks/0',
      headers: { ...authHeader('editor'), 'content-type': 'application/octet-stream' },
      payload: data,
    })
    expect(uploaded.statusCode).toBe(200)
    const completed = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/uploads/' + start.json().id + '/complete',
      headers: authHeader('editor'),
    })
    expect(completed.statusCode).toBe(200)
    const id = completed.json().item.id
    const downloaded = await app.inject({
      method: 'GET',
      url: '/api/post-use-attachments/files/' + id,
      headers: authHeader('viewer'),
    })
    expect(downloaded.statusCode).toBe(200)
    expect(downloaded.rawPayload).toEqual(data)

    const deleted = await app.inject({
      method: 'DELETE',
      url: '/api/post-use-attachments/files/' + id,
      headers: authHeader('editor'),
    })
    expect(deleted.statusCode).toBe(200)
    const { getAttachment } = await import('../postUseAttachmentRepository.js')
    expect(getAttachment(id)).toBeNull()

    const secondStart = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/visit/' + visitId + '/uploads',
      headers: authHeader('editor'),
      payload: { filename: '第二份.csv', sizeBytes: data.length },
    })
    const secondId = secondStart.json().id
    await app.inject({
      method: 'PUT',
      url: '/api/post-use-attachments/uploads/' + secondId + '/chunks/0',
      headers: { ...authHeader('editor'), 'content-type': 'application/octet-stream' },
      payload: data,
    })
    const secondComplete = await app.inject({
      method: 'POST',
      url: '/api/post-use-attachments/uploads/' + secondId + '/complete',
      headers: authHeader('editor'),
    })
    expect(secondComplete.statusCode).toBe(200)
    const deletedVisit = await app.inject({
      method: 'DELETE',
      url: '/api/post-use-visits/' + visitId,
      headers: authHeader('editor'),
    })
    expect(deletedVisit.statusCode).toBe(200)
    expect(getAttachment(secondId)).toBeNull()
  }, 300000)
})
