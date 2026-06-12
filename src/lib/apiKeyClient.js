import { apiFetch } from './apiClient.js'

/**
 * @typedef {import('../domain/apiKey.js').ApiKeyScope} ApiKeyScope
 */

/**
 * @typedef {Object} PublicApiKey
 * @property {string} id
 * @property {string} name
 * @property {string} keyPrefix
 * @property {ApiKeyScope[]} scopes
 * @property {'active' | 'revoked'} status
 * @property {string} createdByUsername
 * @property {string} createdAt
 * @property {string} updatedAt
 * @property {string | null} lastUsedAt
 * @property {string | null} expiresAt
 */

export async function listApiKeys() {
  const data = await apiFetch('/api/api-keys')
  return Array.isArray(data?.items) ? /** @type {PublicApiKey[]} */ (data.items) : []
}

/**
 * @param {{ name: string; scopes: ApiKeyScope[]; expiresAt?: string }} input
 */
export async function createApiKey(input) {
  return apiFetch('/api/api-keys', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * @param {string} id
 */
export async function revokeApiKey(id) {
  return apiFetch(`/api/api-keys/${encodeURIComponent(id)}/revoke`, {
    method: 'POST',
  })
}
