import { getDb } from './db.js'

/**
 * @typedef {Object} KnowledgeBaseRow
 * @property {string} productKey
 * @property {string} productName
 * @property {string} exportDate
 * @property {string} payload KB JSON 字符串
 * @property {string | null} uploadedByUserId
 * @property {string} uploadedByUsername
 * @property {string} uploadedAt
 * @property {number} sizeBytes
 */

/**
 * @typedef {Object} KnowledgeBaseSummary
 * @property {string} productKey
 * @property {string} productName
 * @property {string} exportDate
 * @property {string} uploadedByUsername
 * @property {string} uploadedAt
 * @property {number} sizeBytes
 */

/**
 * @param {Record<string, unknown>} row
 * @returns {KnowledgeBaseRow}
 */
function rowToRecord(row) {
  return {
    productKey: String(row.product_key || ''),
    productName: String(row.product_name || ''),
    exportDate: String(row.export_date || ''),
    payload: String(row.payload || ''),
    uploadedByUserId: row.uploaded_by_user_id ? String(row.uploaded_by_user_id) : null,
    uploadedByUsername: String(row.uploaded_by_username || ''),
    uploadedAt: String(row.uploaded_at || ''),
    sizeBytes: Number(row.size_bytes || 0),
  }
}

/**
 * @param {Record<string, unknown>} row
 * @returns {KnowledgeBaseSummary}
 */
function rowToSummary(row) {
  return {
    productKey: String(row.product_key || ''),
    productName: String(row.product_name || ''),
    exportDate: String(row.export_date || ''),
    uploadedByUsername: String(row.uploaded_by_username || ''),
    uploadedAt: String(row.uploaded_at || ''),
    sizeBytes: Number(row.size_bytes || 0),
  }
}

/**
 * 列出所有已上传知识库（不含 payload）。
 * @returns {KnowledgeBaseSummary[]}
 */
export function listKnowledgeBases() {
  return getDb()
    .prepare(
      `SELECT product_key, product_name, export_date, uploaded_by_username, uploaded_at, size_bytes
       FROM knowledge_bases
       ORDER BY product_key ASC`,
    )
    .all()
    .map((row) => rowToSummary(/** @type {Record<string, unknown>} */ (row)))
}

/**
 * 取某产品知识库原始 payload（JSON 字符串）。
 * @param {string} productKey
 * @returns {KnowledgeBaseRow | null}
 */
export function getKnowledgeBaseRow(productKey) {
  const key = String(productKey ?? '').trim().toLowerCase()
  if (!key) return null
  const row = getDb()
    .prepare(
      `SELECT product_key, product_name, export_date, payload, uploaded_by_user_id,
              uploaded_by_username, uploaded_at, size_bytes
       FROM knowledge_bases WHERE product_key = ?`,
    )
    .get(key)
  return row ? rowToRecord(/** @type {Record<string, unknown>} */ (row)) : null
}

/**
 * 取所有知识库原始行（含 payload），供 loader 批量加载。
 * @returns {KnowledgeBaseRow[]}
 */
export function listKnowledgeBaseRows() {
  return getDb()
    .prepare(
      `SELECT product_key, product_name, export_date, payload, uploaded_by_user_id,
              uploaded_by_username, uploaded_at, size_bytes
       FROM knowledge_bases`,
    )
    .all()
    .map((row) => rowToRecord(/** @type {Record<string, unknown>} */ (row)))
}

/**
 * @returns {number}
 */
export function countKnowledgeBases() {
  const row = getDb().prepare('SELECT COUNT(*) AS n FROM knowledge_bases').get()
  return Number(/** @type {{ n: number }} */ (row).n || 0)
}

/**
 * 新增或替换一个产品知识库。
 * @param {Object} input
 * @param {string} input.productKey
 * @param {string} [input.productName]
 * @param {string} [input.exportDate]
 * @param {string} input.payload KB JSON 字符串
 * @param {{ id?: string | null, username?: string }} [input.user]
 * @returns {KnowledgeBaseSummary}
 */
export function upsertKnowledgeBase(input) {
  const productKey = String(input.productKey ?? '').trim().toLowerCase()
  if (!productKey) throw new Error('productKey 不能为空')
  const payload = String(input.payload ?? '')
  if (!payload) throw new Error('payload 不能为空')
  const productName = String(input.productName ?? '')
  const exportDate = String(input.exportDate ?? '')
  const now = new Date().toISOString()
  const sizeBytes = Buffer.byteLength(payload, 'utf8')

  getDb()
    .prepare(
      `INSERT INTO knowledge_bases (
        product_key, product_name, export_date, payload,
        uploaded_by_user_id, uploaded_by_username, uploaded_at, size_bytes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(product_key) DO UPDATE SET
        product_name = excluded.product_name,
        export_date = excluded.export_date,
        payload = excluded.payload,
        uploaded_by_user_id = excluded.uploaded_by_user_id,
        uploaded_by_username = excluded.uploaded_by_username,
        uploaded_at = excluded.uploaded_at,
        size_bytes = excluded.size_bytes`,
    )
    .run(
      productKey,
      productName,
      exportDate,
      payload,
      input.user?.id ?? null,
      String(input.user?.username ?? ''),
      now,
      sizeBytes,
    )

  return {
    productKey,
    productName,
    exportDate,
    uploadedByUsername: String(input.user?.username ?? ''),
    uploadedAt: now,
    sizeBytes,
  }
}

/**
 * @param {string} productKey
 * @returns {boolean} 是否删除了一行
 */
export function deleteKnowledgeBase(productKey) {
  const key = String(productKey ?? '').trim().toLowerCase()
  if (!key) return false
  const res = getDb().prepare('DELETE FROM knowledge_bases WHERE product_key = ?').run(key)
  return res.changes > 0
}

export const knowledgeBaseRepository = {
  listKnowledgeBases,
  getKnowledgeBaseRow,
  listKnowledgeBaseRows,
  countKnowledgeBases,
  upsertKnowledgeBase,
  deleteKnowledgeBase,
}
