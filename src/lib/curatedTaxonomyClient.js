import { apiFetch } from './apiClient.js'

/**
 * @typedef {Object} CuratedTaxonomySummary
 * @property {string} product
 * @property {string} file
 * @property {boolean} exists
 * @property {number} families
 * @property {string} version
 * @property {string|null} lastModified
 */

/**
 * 列出所有产品的 curated 分类法摘要。
 * @returns {Promise<{ items: CuratedTaxonomySummary[] }>}
 */
export async function listCuratedTaxonomies() {
  return apiFetch('/api/curated-taxonomy')
}

/**
 * 获取某产品的分类法 JSON。
 * @param {string} product - 产品中文名（如"虚拟私有云"）
 * @returns {Promise<Record<string, unknown>>}
 */
export async function getCuratedTaxonomy(product) {
  return apiFetch(`/api/curated-taxonomy/${encodeURIComponent(product)}`)
}

/**
 * 更新某产品的分类法 JSON。
 * @param {string} product - 产品中文名
 * @param {Record<string, unknown>} taxonomy - 完整的分类法 JSON 对象
 * @returns {Promise<{ ok: boolean; product: string; file: string; families: number; lastModified: string }>}
 */
export async function updateCuratedTaxonomy(product, taxonomy) {
  return apiFetch(`/api/curated-taxonomy/${encodeURIComponent(product)}`, {
    method: 'PUT',
    body: JSON.stringify(taxonomy),
  })
}
