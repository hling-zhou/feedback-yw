import { createHash, randomBytes } from 'node:crypto'
import { getDb } from './db.js'
import { randomId } from '../src/lib/randomId.js'
import {
  API_KEY_PREFIX,
  normalizeApiKeyScopes,
} from '../src/domain/apiKey.js'

/**
 * @typedef {import('../src/domain/apiKey.js').ApiKeyScope} ApiKeyScope
 */

/**
 * @typedef {Object} ApiKeyRecord
 * @property {string} id
 * @property {string} name
 * @property {string} keyPrefix
 * @property {ApiKeyScope[]} scopes
 * @property {'active' | 'revoked'} status
 * @property {string | null} createdByUserId
 * @property {string} createdByUsername
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string | null} lastUsedAt
 * @property {string | null} expiresAt
 */

/**
 * @typedef {ApiKeyRecord & { keyHash: string }} ApiKeyRow
 */

/**
 * @param {string} rawKey
 */
export function hashApiKey(rawKey) {
  return createHash('sha256').update(rawKey).digest('hex')
}

/**
 * @param {string} rawKey
 */
export function getApiKeyPrefix(rawKey) {
  return rawKey.slice(0, Math.min(rawKey.length, 16))
}

export function generateApiKeySecret() {
  return `${API_KEY_PREFIX}${randomBytes(32).toString('base64url')}`
}

/**
 * @param {Record<string, unknown>} row
 */
function rowToRecord(row) {
  /** @type {ApiKeyScope[]} */
  let scopes = []
  try {
    const parsed = JSON.parse(String(row.scopes_json || '[]'))
    scopes = normalizeApiKeyScopes(Array.isArray(parsed) ? parsed : [])
  } catch {
    scopes = []
  }
  return {
    id: String(row.id),
    name: String(row.name || ''),
    keyPrefix: String(row.key_prefix || ''),
    scopes,
    status: row.status === 'revoked' ? 'revoked' : 'active',
    createdByUserId: row.created_by_user_id ? String(row.created_by_user_id) : null,
    createdByUsername: String(row.created_by_username || ''),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    lastUsedAt: row.last_used_at ? String(row.last_used_at) : null,
    expiresAt: row.expires_at ? String(row.expires_at) : null,
  }
}

/**
 * @param {ApiKeyRecord} record
 */
export function toPublicApiKey(record) {
  return {
    id: record.id,
    name: record.name,
    keyPrefix: record.keyPrefix,
    scopes: record.scopes,
    status: record.status,
    createdByUsername: record.createdByUsername,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
    lastUsedAt: record.lastUsedAt,
    expiresAt: record.expiresAt,
  }
}

export function listApiKeys() {
  const db = getDb()
  return db
    .prepare(
      `SELECT id, name, key_prefix, scopes_json, status, created_by_user_id, created_by_username,
              created_at, updated_at, last_used_at, expires_at
       FROM api_keys
       ORDER BY created_at DESC`,
    )
    .all()
    .map((row) => toPublicApiKey(rowToRecord(/** @type {Record<string, unknown>} */ (row))))
}

/**
 * @param {Object} input
 * @param {string} input.name
 * @param {ApiKeyScope[]} input.scopes
 * @param {string | null | undefined} [input.createdByUserId]
 * @param {string} [input.createdByUsername]
 * @param {string | null | undefined} [input.expiresAt]
 */
export function createApiKey(input) {
  const name = String(input.name ?? '').trim()
  if (!name) throw new Error('Key 名称不能为空')

  const scopes = normalizeApiKeyScopes(input.scopes || [])
  if (!scopes.length) throw new Error('至少选择一个权限范围')

  const rawKey = generateApiKeySecret()
  const now = new Date().toISOString()
  const id = randomId()
  const record = {
    id,
    name,
    keyPrefix: getApiKeyPrefix(rawKey),
    keyHash: hashApiKey(rawKey),
    scopes,
    status: /** @type {'active'} */ ('active'),
    createdByUserId: input.createdByUserId ?? null,
    createdByUsername: String(input.createdByUsername ?? ''),
    createdAt: now,
    updatedAt: now,
    lastUsedAt: null,
    expiresAt: input.expiresAt?.trim() || null,
  }

  getDb()
    .prepare(
      `INSERT INTO api_keys (
        id, name, key_prefix, key_hash, scopes_json, status,
        created_by_user_id, created_by_username, created_at, updated_at, last_used_at, expires_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      record.id,
      record.name,
      record.keyPrefix,
      record.keyHash,
      JSON.stringify(record.scopes),
      record.status,
      record.createdByUserId,
      record.createdByUsername,
      record.createdAt,
      record.updatedAt,
      record.lastUsedAt,
      record.expiresAt,
    )

  return {
    apiKey: toPublicApiKey(record),
    secret: rawKey,
  }
}

/**
 * @param {string} id
 */
export function revokeApiKey(id) {
  const db = getDb()
  const row = db.prepare('SELECT id FROM api_keys WHERE id = ?').get(id)
  if (!row) throw new Error('API Key 不存在')

  const now = new Date().toISOString()
  db.prepare(
    `UPDATE api_keys SET status = 'revoked', updated_at = ? WHERE id = ?`,
  ).run(now, id)

  const updated = db
    .prepare(
      `SELECT id, name, key_prefix, scopes_json, status, created_by_user_id, created_by_username,
              created_at, updated_at, last_used_at, expires_at
       FROM api_keys WHERE id = ?`,
    )
    .get(id)
  return toPublicApiKey(rowToRecord(/** @type {Record<string, unknown>} */ (updated)))
}

/**
 * @param {string} rawKey
 * @returns {ApiKeyRecord | null}
 */
export function verifyApiKey(rawKey) {
  if (!rawKey?.startsWith(API_KEY_PREFIX)) return null

  const db = getDb()
  const keyHash = hashApiKey(rawKey)
  const row = db
    .prepare(
      `SELECT id, name, key_prefix, scopes_json, status, created_by_user_id, created_by_username,
              created_at, updated_at, last_used_at, expires_at
       FROM api_keys WHERE key_hash = ?`,
    )
    .get(keyHash)
  if (!row) return null

  const record = rowToRecord(/** @type {Record<string, unknown>} */ (row))
  if (record.status !== 'active') return null
  if (record.expiresAt && new Date(record.expiresAt).getTime() < Date.now()) return null

  const now = new Date().toISOString()
  db.prepare('UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(
    now,
    now,
    record.id,
  )
  record.lastUsedAt = now
  record.updatedAt = now
  return record
}

/**
 * @param {ApiKeyRecord | null | undefined} apiKey
 * @param {ApiKeyScope} scope
 */
export function apiKeyHasScope(apiKey, scope) {
  if (!apiKey || apiKey.status !== 'active') return false
  if (apiKey.expiresAt && new Date(apiKey.expiresAt).getTime() < Date.now()) return false
  return apiKey.scopes.includes(scope)
}

export const apiKeyRepository = {
  listApiKeys,
  createApiKey,
  revokeApiKey,
  verifyApiKey,
  apiKeyHasScope,
  hashApiKey,
  generateApiKeySecret,
}
