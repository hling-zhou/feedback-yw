import fs from 'node:fs'
import { requirePermission } from '../middleware.js'
import { hasPermission } from '../../src/domain/auth/permissions.js'
import { META_KEY_POST_USE_VISITS } from '../../src/lib/postUseRating/visitRecords.js'
import { postUseJiraRepository } from '../postUseJiraRepository.js'
import { storageRepository } from '../storageRepository.js'
import { logAuditFromRequest } from '../audit.js'
import {
  ATTACHMENT_CHUNK_BYTES,
  cancelAttachmentUpload,
  cleanupExpiredAttachmentUploads,
  completeAttachmentUpload,
  createAttachmentUpload,
  deleteAttachment,
  getAttachment,
  getAttachmentFilePath,
  getAttachmentUpload,
  listAttachments,
  writeAttachmentChunk,
} from '../postUseAttachmentRepository.js'

/** @param {unknown} value */
function validOwnerType(value) { return value === 'trace' || value === 'visit' }

/** @param {'trace'|'visit'} ownerType @param {string} ownerId */
function ownerExists(ownerType, ownerId) {
  if (ownerType === 'trace') return Boolean(postUseJiraRepository.getById(ownerId))
  const raw = storageRepository.getMeta(META_KEY_POST_USE_VISITS)
  return Array.isArray(raw?.records) && raw.records.some((item) => String(item?.id || '') === ownerId)
}

/** @param {import('fastify').FastifyRequest} request @param {import('fastify').FastifyReply} reply */
function requireAttachmentEdit(request, reply) {
  if (!request.user) {
    reply.code(401).send({ error: '未登录' })
    return false
  }
  if (!hasPermission(request.user.role, 'editRecord')) {
    reply.code(403).send({ error: '无权限执行此操作' })
    return false
  }
  return true
}

/** @param {import('fastify').FastifyReply} reply @param {unknown} error */
function sendAttachmentError(reply, error) {
  const message = error instanceof Error ? error.message : '附件操作失败'
  const code = /** @type {any} */ (error)?.code
  const inputMessages = ['文件大小无效', '上传分片无效', '上传分片与已接收内容不一致',
    '重复分片内容不一致', '上传分片顺序或大小不正确', '文件尚未上传完成', '文件内容与格式不匹配']
  const status = code === 'ENOSPC' ? 507 : inputMessages.includes(message) || message.startsWith('仅支持') ? 400 : 500
  return reply.code(status).send({ error: status === 500 ? '附件操作失败，请稍后重试' : message })
}

/** @param {import('fastify').FastifyInstance} app */
export function registerPostUseAttachmentRoutes(app) {
  app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer' }, (_request, body, done) => done(null, body))

  app.get('/api/post-use-attachments/:ownerType/:ownerId', { preHandler: requirePermission('view') }, async (request, reply) => {
    const { ownerType, ownerId } = /** @type {{ ownerType: string; ownerId: string }} */ (request.params)
    if (!validOwnerType(ownerType)) return reply.code(400).send({ error: '附件归属类型无效' })
    if (!ownerExists(ownerType, ownerId)) return reply.code(404).send({ error: '记录不存在' })
    const query = /** @type {{ limit?: string; offset?: string }} */ (request.query || {})
    const limit = Math.min(100, Math.max(1, Number(query.limit) || 50))
    const offset = Math.max(0, Number(query.offset) || 0)
    return listAttachments(ownerType, ownerId, limit, offset)
  })

  app.post('/api/post-use-attachments/:ownerType/:ownerId/uploads', async (request, reply) => {
    if (!requireAttachmentEdit(request, reply)) return
    const { ownerType, ownerId } = /** @type {{ ownerType: string; ownerId: string }} */ (request.params)
    if (!validOwnerType(ownerType)) return reply.code(400).send({ error: '附件归属类型无效' })
    if (!ownerExists(ownerType, ownerId)) return reply.code(404).send({ error: '记录不存在' })
    const body = /** @type {{ filename?: string; sizeBytes?: number }} */ (request.body || {})
    try {
      cleanupExpiredAttachmentUploads()
      return createAttachmentUpload({
        ownerType,
        ownerId,
        filename: String(body.filename || ''),
        sizeBytes: Number(body.sizeBytes),
        userId: request.user.id,
        username: request.user.username,
      })
    } catch (error) { return sendAttachmentError(reply, error) }
  })

  app.get('/api/post-use-attachments/uploads/:uploadId', async (request, reply) => {
    if (!requireAttachmentEdit(request, reply)) return
    const { uploadId } = /** @type {{ uploadId: string }} */ (request.params)
    const upload = getAttachmentUpload(uploadId, request.user.id)
    if (!upload || !ownerExists(upload.ownerType, upload.ownerId)) return reply.code(404).send({ error: '上传任务不存在' })
    return upload
  })

  app.put('/api/post-use-attachments/uploads/:uploadId/chunks/:index', {
    bodyLimit: ATTACHMENT_CHUNK_BYTES,
  }, async (request, reply) => {
    if (!requireAttachmentEdit(request, reply)) return
    const { uploadId, index } = /** @type {{ uploadId: string; index: string }} */ (request.params)
    const upload = getAttachmentUpload(uploadId, request.user.id)
    if (!upload || !ownerExists(upload.ownerType, upload.ownerId)) return reply.code(404).send({ error: '上传任务不存在' })
    try {
      const result = writeAttachmentChunk(uploadId, request.user.id, Number(index), /** @type {Buffer} */ (request.body))
      return result || reply.code(404).send({ error: '上传任务不存在' })
    } catch (error) { return sendAttachmentError(reply, error) }
  })

  app.post('/api/post-use-attachments/uploads/:uploadId/complete', async (request, reply) => {
    if (!requireAttachmentEdit(request, reply)) return
    const { uploadId } = /** @type {{ uploadId: string }} */ (request.params)
    const upload = getAttachmentUpload(uploadId, request.user.id)
    if (!upload || !ownerExists(upload.ownerType, upload.ownerId)) return reply.code(404).send({ error: '上传任务不存在' })
    try {
      const item = await completeAttachmentUpload(uploadId, request.user.id)
      if (!item) return reply.code(404).send({ error: '上传任务不存在' })
      logAuditFromRequest(request, 'post_use_attachment.upload', { id: item.id, ownerType: item.ownerType, ownerId: item.ownerId, filename: item.filename, sizeBytes: item.sizeBytes })
      return { item }
    } catch (error) { return sendAttachmentError(reply, error) }
  })

  app.delete('/api/post-use-attachments/uploads/:uploadId', async (request, reply) => {
    if (!requireAttachmentEdit(request, reply)) return
    const { uploadId } = /** @type {{ uploadId: string }} */ (request.params)
    const ok = cancelAttachmentUpload(uploadId, request.user.id)
    return ok ? { ok: true } : reply.code(404).send({ error: '上传任务不存在' })
  })

  app.get('/api/post-use-attachments/files/:id', { preHandler: requirePermission('view') }, async (request, reply) => {
    const { id } = /** @type {{ id: string }} */ (request.params)
    const item = getAttachment(id)
    if (!item || !ownerExists(item.ownerType, item.ownerId)) return reply.code(404).send({ error: '附件不存在' })
    const file = getAttachmentFilePath(id)
    if (!file || !fs.existsSync(file)) return reply.code(410).send({ error: '附件文件已丢失' })
    const query = /** @type {{ inline?: string }} */ (request.query || {})
    const inline = query.inline === '1' && item.previewable
    const disposition = inline ? 'inline' : 'attachment'
    reply.header('Content-Type', item.mimeType)
      .header('Content-Length', String(item.sizeBytes))
      .header('Content-Disposition', `${disposition}; filename="attachment"; filename*=UTF-8''${encodeURIComponent(item.filename)}`)
      .header('X-Content-Type-Options', 'nosniff')
      .header('Cache-Control', 'private, no-store')
    return reply.send(fs.createReadStream(file))
  })

  app.delete('/api/post-use-attachments/files/:id', async (request, reply) => {
    if (!requireAttachmentEdit(request, reply)) return
    const { id } = /** @type {{ id: string }} */ (request.params)
    const item = getAttachment(id)
    if (!item || !ownerExists(item.ownerType, item.ownerId)) return reply.code(404).send({ error: '附件不存在' })
    try {
      deleteAttachment(id)
      logAuditFromRequest(request, 'post_use_attachment.delete', { id, ownerType: item.ownerType, ownerId: item.ownerId, filename: item.filename })
      return { ok: true }
    } catch (error) { return sendAttachmentError(reply, error) }
  })
}
