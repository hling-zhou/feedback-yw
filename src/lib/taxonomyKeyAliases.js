/** 产品目录 / 历史导入 key → 旅程模板 key */
const TAXONOMY_KEY_ALIASES = {
  ecc: 'dc',
  yunzx: 'dc',
  yunzhuanxian: 'dc',
  SLB: 'slb',
}

/**
 * 将产品 key 规范为标签库中的旅程模板 key。
 * @param {string | undefined | null} key
 * @returns {string}
 */
export function canonicalTaxonomyKey(key) {
  const raw = key?.trim()
  if (!raw) return ''
  const lower = raw.toLowerCase()
  return TAXONOMY_KEY_ALIASES[raw] || TAXONOMY_KEY_ALIASES[lower] || raw
}

/**
 * 修正记录上的 productKey / taxonomyKey（旧导入 ecc、小写 slb 等）。
 * @param {import('./types.js').FeedbackRecord} record
 * @returns {boolean} 是否有字段被改写
 */
export function normalizeRecordTaxonomyKeys(record) {
  if (!record) return false
  let changed = false
  for (const field of ['productKey', 'taxonomyKey']) {
    const value = record[field]?.trim()
    if (!value) continue
    const next = canonicalTaxonomyKey(value)
    if (next && next !== record[field]) {
      record[field] = next
      changed = true
    }
  }
  return changed
}
