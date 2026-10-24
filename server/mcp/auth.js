/**
 * MCP Server 认证模块：API Key 验证 + scope 校验。
 *
 * 复用 apiKeyRepository.verifyApiKey 做 token 校验，
 * 在此基础上检查 mcp:read / mcp:full scope。
 */

import { verifyApiKey } from '../apiKeyRepository.js'

/**
 * @typedef {import('../apiKeyRepository.js').ApiKeyRecord} ApiKeyRecord
 */

/**
 * 从请求头提取 Bearer Token。
 * MCP SSE 传输模式下，Agent 在 SSE 连接的 HTTP 请求中携带 Authorization: Bearer <api-key>。
 *
 * @param {import('node:http').IncomingMessage} req
 * @returns {string}
 */
export function extractBearerToken(req) {
  const header = req.headers['authorization'] || ''
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]?.trim() || ''
}

/**
 * 验证 API Key 并检查是否具备 MCP scope。
 *
 * @param {string} token
 * @returns {{ ok: true, apiKey: ApiKeyRecord } | { ok: false, error: string, status: number }}
 */
export function authenticateMcpRequest(token) {
  if (!token) {
    return { ok: false, error: '缺少 Authorization Bearer Token', status: 401 }
  }

  const apiKey = verifyApiKey(token)
  if (!apiKey) {
    return { ok: false, error: 'API Key 无效、已吊销或已过期', status: 401 }
  }

  const hasMcpRead = apiKey.scopes.includes('mcp:read') || apiKey.scopes.includes('mcp:full')
  if (!hasMcpRead) {
    return { ok: false, error: 'API Key 不具备 MCP 读取权限（需要 mcp:read 或 mcp:full scope）', status: 403 }
  }

  return { ok: true, apiKey }
}

/**
 * 判断 API Key 是否允许关闭脱敏。
 *
 * @param {ApiKeyRecord | null} apiKey
 * @returns {boolean}
 */
export function canDisableDesensitize(apiKey) {
  if (!apiKey) return false
  return apiKey.scopes.includes('mcp:full')
}
