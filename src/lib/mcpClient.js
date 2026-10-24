import { apiFetch } from './apiClient.js'

/**
 * @typedef {{ read: string; full: string } | null} McpSharedKeysMasked
 */

/**
 * @returns {Promise<{ keys: McpSharedKeysMasked }>}
 */
export async function getMcpSharedKeys() {
  return apiFetch('/api/mcp/shared-keys')
}

/**
 * @param {{ password: string; scope: 'read' | 'full' }} input
 * @returns {Promise<{ secret: string }>}
 */
export async function revealMcpKey(input) {
  return apiFetch('/api/mcp/reveal-key', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * @param {{ read?: string; full?: string }} input
 * @returns {Promise<{ keys: McpSharedKeysMasked }>}
 */
export async function updateMcpSharedKeys(input) {
  return apiFetch('/api/mcp/shared-keys', {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}
