/** @typedef {'requirement_ticket_progress:import'} ApiKeyScope */

export const API_KEY_PREFIX = 'fi_live_'

/** @type {ApiKeyScope[]} */
export const API_KEY_SCOPES = ['requirement_ticket_progress:import']

/** @type {Record<ApiKeyScope, string>} */
export const API_KEY_SCOPE_LABELS = {
  'requirement_ticket_progress:import': '导入需求工单进展',
}

/**
 * @param {string | null | undefined} token
 */
export function isApiKeyFormat(token) {
  return typeof token === 'string' && token.startsWith(API_KEY_PREFIX) && token.length >= 20
}

/**
 * @param {unknown} scope
 * @returns {scope is ApiKeyScope}
 */
export function isApiKeyScope(scope) {
  return typeof scope === 'string' && API_KEY_SCOPES.includes(/** @type {ApiKeyScope} */ (scope))
}

/**
 * @param {unknown[]} scopes
 * @returns {ApiKeyScope[]}
 */
export function normalizeApiKeyScopes(scopes) {
  return [...new Set((scopes || []).filter(isApiKeyScope))]
}
