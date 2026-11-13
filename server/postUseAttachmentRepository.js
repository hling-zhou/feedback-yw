import fs from 'node:fs'
import path from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { getDb } from './db.js'

export const ATTACHMENT_CHUNK_BYTES = 4 * 1024 * 1024
const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const serverDir = path.dirname(fileURLToPath(import.meta.url))
const dataDir = process.env.SERVER_DATA_DIR
  || (process.env.AUTH_DATABASE_PATH ? path.dirname(process.env.AUTH_DATABASE_PATH) : path.join(serverDir, 'data'))
const rootDir = process.env.POST_USE_ATTACHMENT_DIR || path.join(dataDir, 'post-use-attachments')
const pendingDir = path.join(rootDir, 'pending')
const filesDir = path.join(rootDir, 'files')
const trashDir = path.join(rootDir, 'trash')

const MIME_BY_EXT = /** @type {Record<string, string>} */ ({
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.gif': 'image/gif', '.webp': 'image/webp', '.bmp': 'image/bmp',
  '.tif': 'image/tiff', '.tiff': 'image/tiff', '.heic': 'image/heic',
  '.heif': 'image/heif', '.avif': 'image/avif', '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf', '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.csv': 'text/csv',
})

/** @param {string} filename */
export function attachmentFileType(filename) {
  const name = path.basename(String(filename || '').replaceAll('\\', '/')).trim()
  const extension = path.extname(name).toLowerCase()
  return name && MIME_BY_EXT[extension] ? { name, extension, mimeType: MIME_BY_EXT[extension] } : null
}

function ensureDirs() {
  fs.mkdirSync(pendingDir, { recursive: true })
  fs.mkdirSync(filesDir, { recursive: true })
  fs.mkdirSync(trashDir, { recursive: true })
}

/** @param {string} id */
function pendingPath(id) { return path.join(pendingDir, id) }
/** @param {string} id */
function filePath(id) { return path.join(filesDir, id) }

/** @param {Record<string, any>} row */
function publicAttachment(row) {
  return {
    id: row.id,
    ownerType: row.owner_type,
    ownerId: row.owner_id,
    filename: row.filename,
    mimeType: row.mime_type,
    sizeBytes: row.size_bytes,
    sha256: row.sha256,
    uploadedByUserId: row.uploaded_by_user_id,
    uploadedByUsername: row.uploaded_by_username,
    uploadedAt: row.uploaded_at,
    previewable: row.mime_type === 'application/pdf'
      || (row.mime_type.startsWith('image/') && row.mime_type !== 'image/svg+xml'),
  }
}

/** @param {string} file */
async function hashFile(file) {
  const hash = createHash('sha256')
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk)
  return hash.digest('hex')
}

/** @param {string} file @param {string} extension */
function hasExpectedSignature(file, extension) {
  const buffer = Buffer.alloc(4096)
  const fd = fs.openSync(file, 'r')
  let length = 0
  try { length = fs.readSync(fd, buffer, 0, buffer.length, 0) } finally { fs.closeSync(fd) }
  const head = buffer.subarray(0, length)
  if (extension === '.csv') return !head.includes(0)
  if (extension === '.svg') return /<svg[\s>]/i.test(head.toString('utf8').replace(/^\uFEFF/, '').slice(0, 4096))
  if (extension === '.pdf') return head.subarray(0, 5).toString() === '%PDF-'
  if (extension === '.png') return head.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  if (extension === '.jpg' || extension === '.jpeg') return head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff
  if (extension === '.gif') return /^GIF8[79]a/.test(head.toString('ascii', 0, 6))
  if (extension === '.webp') return head.toString('ascii', 0, 4) === 'RIFF' && head.toString('ascii', 8, 12) === 'WEBP'
  if (extension === '.bmp') return head.toString('ascii', 0, 2) === 'BM'
  if (extension === '.tif' || extension === '.tiff') return head.subarray(0, 4).equals(Buffer.from([73, 73, 42, 0])) || head.subarray(0, 4).equals(Buffer.from([77, 77, 0, 42]))
  if (extension === '.doc' || extension === '.xls') return head.subarray(0, 8).equals(Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]))
  if (extension === '.docx' || extension === '.xlsx') return head.subarray(0, 4).equals(Buffer.from([80, 75, 3, 4]))
  if (extension === '.heic' || extension === '.heif' || extension === '.avif') {
    return head.toString('ascii', 4, 8) === 'ftyp'
  }
  return false
}

/** @param {string} uploadId */
function getUploadRow(uploadId) {
  return getDb().prepare('SELECT * FROM post_use_attachment_uploads WHERE id = ?').get(uploadId)
}

/** @param {string} uploadId @param {string} userId */
export function getAttachmentUpload(uploadId, userId) {
  const row = getUploadRow(uploadId)
  if (!row || row.uploaded_by_user_id !== userId) return null
  return { id: row.id, ownerType: row.owner_type, ownerId: row.owner_id, filename: row.filename, sizeBytes: row.size_bytes, receivedBytes: row.received_bytes }
}

/**
 * @param {{ ownerType: 'trace'|'visit'; ownerId: string; filename: string; sizeBytes: number; userId: string; username: string }} input
 */
export function createAttachmentUpload(input) {
  const type = attachmentFileType(input.filename)
  if (!type) throw new Error('仅支持图片、PDF、Word、Excel、CSV 文件')
  if (!Number.isSafeInteger(input.sizeBytes) || input.sizeBytes < 0) throw new Error('文件大小无效')
  ensureDirs()
  const id = randomUUID()
  fs.closeSync(fs.openSync(pendingPath(id), 'wx'))
  try {
    getDb().prepare(`INSERT INTO post_use_attachment_uploads
      (id, owner_type, owner_id, filename, mime_type, size_bytes, received_bytes, uploaded_by_user_id, uploaded_by_username, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`)
      .run(id, input.ownerType, input.ownerId, type.name, type.mimeType, input.sizeBytes, input.userId, input.username, new Date().toISOString())
  } catch (error) {
    fs.rmSync(pendingPath(id), { force: true })
    throw error
  }
  return { id, chunkBytes: ATTACHMENT_CHUNK_BYTES, receivedBytes: 0 }
}

/** @param {string} uploadId @param {string} userId @param {number} index @param {Buffer} chunk */
export function writeAttachmentChunk(uploadId, userId, index, chunk) {
  if (!Number.isSafeInteger(index) || index < 0 || !Buffer.isBuffer(chunk) || !chunk.length || chunk.length > ATTACHMENT_CHUNK_BYTES) {
    throw new Error('上传分片无效')
  }
  const db = getDb()
  return db.transaction(() => {
    const row = getUploadRow(uploadId)
    if (!row || row.uploaded_by_user_id !== userId) return null
    const offset = index * ATTACHMENT_CHUNK_BYTES
    if (offset < row.received_bytes) {
      if (offset + chunk.length > row.received_bytes) throw new Error('上传分片与已接收内容不一致')
      const existing = Buffer.alloc(chunk.length)
      const fd = fs.openSync(pendingPath(uploadId), 'r')
      try { fs.readSync(fd, existing, 0, existing.length, offset) } finally { fs.closeSync(fd) }
      if (!existing.equals(chunk)) throw new Error('重复分片内容不一致')
      return { receivedBytes: row.received_bytes }
    }
    const expectedSize = Math.min(ATTACHMENT_CHUNK_BYTES, row.size_bytes - row.received_bytes)
    if (offset !== row.received_bytes || chunk.length !== expectedSize) throw new Error('上传分片顺序或大小不正确')
    const fd = fs.openSync(pendingPath(uploadId), 'r+')
    try {
      fs.ftruncateSync(fd, row.received_bytes)
      let written = 0
      while (written < chunk.length) {
        written += fs.writeSync(fd, chunk, written, chunk.length - written, offset + written)
      }
    } finally { fs.closeSync(fd) }
    const receivedBytes = row.received_bytes + chunk.length
    db.prepare('UPDATE post_use_attachment_uploads SET received_bytes = ? WHERE id = ?').run(receivedBytes, uploadId)
    return { receivedBytes }
  })()
}

/** @param {string} uploadId @param {string} userId */
export async function completeAttachmentUpload(uploadId, userId) {
  const row = getUploadRow(uploadId)
  if (!row || row.uploaded_by_user_id !== userId) return null
  const type = attachmentFileType(row.filename)
  if (!type || row.received_bytes !== row.size_bytes) throw new Error('文件尚未上传完成')
  const source = pendingPath(uploadId)
  if (fs.statSync(source).size !== row.size_bytes || !hasExpectedSignature(source, type.extension)) {
    throw new Error('文件内容与格式不匹配')
  }
  const sha256 = await hashFile(source)
  const target = filePath(uploadId)
  fs.renameSync(source, target)
  try {
    getDb().transaction(() => {
      getDb().prepare(`INSERT INTO post_use_attachments
        (id, owner_type, owner_id, filename, mime_type, size_bytes, sha256, storage_key, uploaded_by_user_id, uploaded_by_username, uploaded_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uploadId, row.owner_type, row.owner_id, row.filename, row.mime_type, row.size_bytes, sha256, uploadId, row.uploaded_by_user_id, row.uploaded_by_username, new Date().toISOString())
      getDb().prepare('DELETE FROM post_use_attachment_uploads WHERE id = ?').run(uploadId)
    })()
  } catch (error) {
    fs.renameSync(target, source)
    throw error
  }
  return getAttachment(uploadId)
}

/** @param {string} uploadId @param {string} userId */
export function cancelAttachmentUpload(uploadId, userId) {
  const row = getUploadRow(uploadId)
  if (!row || row.uploaded_by_user_id !== userId) return false
  getDb().prepare('DELETE FROM post_use_attachment_uploads WHERE id = ?').run(uploadId)
  fs.rmSync(pendingPath(uploadId), { force: true })
  return true
}

/** @param {'trace'|'visit'} ownerType @param {string} ownerId @param {number} limit @param {number} offset */
export function listAttachments(ownerType, ownerId, limit = 50, offset = 0) {
  const db = getDb()
  const total = db.prepare('SELECT COUNT(*) AS total FROM post_use_attachments WHERE owner_type = ? AND owner_id = ?').get(ownerType, ownerId).total
  const rows = db.prepare(`SELECT * FROM post_use_attachments WHERE owner_type = ? AND owner_id = ?
    ORDER BY uploaded_at DESC, id DESC LIMIT ? OFFSET ?`).all(ownerType, ownerId, limit, offset)
  return { items: rows.map(publicAttachment), total, limit, offset }
}

/** @param {string} id */
export function getAttachment(id) {
  const row = getDb().prepare('SELECT * FROM post_use_attachments WHERE id = ?').get(id)
  return row ? publicAttachment(row) : null
}

/** @param {string} id */
export function getAttachmentFilePath(id) {
  const row = getDb().prepare('SELECT storage_key FROM post_use_attachments WHERE id = ?').get(id)
  return row ? filePath(row.storage_key) : null
}

/** @param {string} id */
export function deleteAttachment(id) {
  const row = getDb().prepare('SELECT storage_key FROM post_use_attachments WHERE id = ?').get(id)
  if (!row) return false
  ensureDirs()
  const source = filePath(row.storage_key)
  const trash = path.join(trashDir, row.storage_key)
  if (fs.existsSync(source)) fs.renameSync(source, trash)
  try {
    getDb().prepare('DELETE FROM post_use_attachments WHERE id = ?').run(id)
  } catch (error) {
    if (fs.existsSync(trash)) fs.renameSync(trash, source)
    throw error
  }
  fs.rmSync(trash, { force: true })
  return true
}

/** @param {'trace'|'visit'} ownerType @param {string} ownerId */
export function deleteAttachmentsForOwner(ownerType, ownerId) {
  const rows = getDb().prepare('SELECT id FROM post_use_attachments WHERE owner_type = ? AND owner_id = ?').all(ownerType, ownerId)
  for (const row of rows) deleteAttachment(row.id)
  const uploads = getDb().prepare('SELECT id FROM post_use_attachment_uploads WHERE owner_type = ? AND owner_id = ?').all(ownerType, ownerId)
  for (const row of uploads) {
    getDb().prepare('DELETE FROM post_use_attachment_uploads WHERE id = ?').run(row.id)
    fs.rmSync(pendingPath(row.id), { force: true })
  }
  return rows.length
}

export function cleanupExpiredAttachmentUploads() {
  const cutoff = new Date(Date.now() - UPLOAD_TTL_MS).toISOString()
  const rows = getDb().prepare('SELECT id FROM post_use_attachment_uploads WHERE created_at < ?').all(cutoff)
  for (const row of rows) {
    getDb().prepare('DELETE FROM post_use_attachment_uploads WHERE id = ?').run(row.id)
    fs.rmSync(pendingPath(row.id), { force: true })
  }
  return rows.length
}
