export const POST_USE_QUALITY_SCHEMA_VERSION = 1
export const POST_USE_ANALYSIS_RULE_VERSION = 'pur-insight-v1'
export const POST_USE_REASON_RULE_VERSION = 'pur-reason-v2'

/** @param {Array<{ key?: string; name?: string; analysisPostUseRating?: boolean; focusTracked?: boolean; specs?: unknown[] }>} products */
export function buildPostUseCatalogVersion(products = []) {
  const source = products
    .map((p) => [p.key || '', p.name || '', !!p.analysisPostUseRating, !!p.focusTracked, p.specs?.length || 0].join(':'))
    .sort()
    .join('|')
  let hash = 2166136261
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return `catalog-${(hash >>> 0).toString(16)}`
}
