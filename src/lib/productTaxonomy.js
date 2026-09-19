/**
 * 产品 taxonomy 入口：定义来自 public/config/taxonomy/*.json（见 taxonomyLoader.js）
 */
export {
  getAllProducts as PRODUCT_TAXONOMY,
  resolveTaxonomyKey,
  getTaxonomy,
  getTaxonomyForRecord,
  getJourneyReference,
  listJourneyTemplates,
  getThemeRulesForRecord,
  getThemeRulesForProduct,
  getEipNodeMaps,
} from './taxonomyLoader.js'

import { getAllProducts, getTaxonomy, resolveTaxonomyKey } from './taxonomyLoader.js'

export function resolveProductKey(productName) {
  return resolveTaxonomyKey(productName)
}

export function listProducts(feedbacks) {
  const map = new Map()
  for (const fb of feedbacks) {
    const name = fb.product?.trim() || '未标注产品'
    const entry = map.get(name) || { count: 0, specs: new Set() }
    entry.count += 1
    if (fb.productSpec?.trim()) entry.specs.add(fb.productSpec.trim())
    map.set(name, entry)
  }
  return [...map.entries()]
    .map(([name, { count, specs }]) => ({
      name,
      count,
      key: resolveTaxonomyKey(name),
      specs: [...specs],
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * 按产品目录过滤：只保留 enabled=true 的产品。
 * 用于工作台 / 分析页的产品下拉，避免出现目录外产品（如云主机ECS、云电脑等）。
 * 目录为空时回退为全量列表（避免配置未加载时筛空）。
 *
 * @param {import('./productCatalogLoader.js').CatalogProduct[] | null | undefined} catalog
 * @param {{ name: string; count: number; key: string; specs: string[] }[]} listed
 * @returns {{ name: string; count: number; key: string; specs: string[] }[]}
 */
export function filterProductsByCatalog(catalog, listed) {
  if (!Array.isArray(catalog) || catalog.length === 0) return listed
  const allow = new Set(
    catalog
      .filter((p) => p?.enabled)
      .map((p) => String(p.name || '').trim())
      .filter(Boolean),
  )
  return listed.filter((item) => allow.has(item.name))
}

export function listResourcePools(feedbacks, productFilter) {
  const map = new Map()
  for (const fb of feedbacks) {
    if (productFilter && fb.product !== productFilter) continue
    const pool = fb.resourcePool?.trim() || '未标注资源池'
    map.set(pool, (map.get(pool) || 0) + 1)
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count }))
}
