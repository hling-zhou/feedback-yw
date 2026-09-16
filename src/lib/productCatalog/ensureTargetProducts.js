/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */

import { POST_USE_RATING_CATALOG_SEED_PRODUCTS } from './postUseRatingProducts.js'
import { normalizeCatalogMatchText } from './resolveCatalogProduct.js'

/**
 * 与 public/config/product-catalog/product-catalog.json 对齐的目标产品种子。
 * 共享库若早于这些产品上线，加载时自动补全，避免发布/导出 Excel 缺行。
 * @type {CatalogProduct[]}
 */
export const TARGET_CATALOG_SEED_PRODUCTS = [
  {
    key: 'dc',
    name: '云专线',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'dc',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'slb',
    name: '弹性负载均衡',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'slb',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'vpc',
    name: '虚拟私有云',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'vpc',
    acceptParentName: true,
    specs: [
      {
        name: '虚拟私有云',
        match: ['虚拟私有云', 'VPC', 'vpc', '专有网络', '私有网络'],
      },
    ],
  },
  {
    key: 'eip',
    name: '弹性公网IP',
    enabled: true,
    analysisPostUseRating: true,
    focusTracked: true,
    taxonomyKey: 'eip',
    acceptParentName: true,
    specs: [],
  },
]

/** 工单目标产品 + 用后即评 16 款补齐（按 key 去重，后者不覆盖前者已有字段除非缺失） */
export const ALL_CATALOG_SEED_PRODUCTS = (() => {
  /** @type {Map<string, CatalogProduct>} */
  const map = new Map()
  for (const p of [...TARGET_CATALOG_SEED_PRODUCTS, ...POST_USE_RATING_CATALOG_SEED_PRODUCTS]) {
    if (!map.has(p.key)) {
      map.set(p.key, structuredClone(p))
      continue
    }
    const cur = map.get(p.key)
    map.set(p.key, mergeCatalogProduct(cur, p))
  }
  return [...map.values()]
})()

/**
 * @param {CatalogProduct} a
 * @param {CatalogProduct} b
 */
function mergeCatalogProduct(a, b) {
  const specByName = new Map((a.specs || []).map((s) => [s.name, { ...s }]))
  for (const spec of b.specs || []) {
    if (!specByName.has(spec.name)) {
      specByName.set(spec.name, { ...spec })
    }
  }
  return {
    ...a,
    name: a.name?.trim() || b.name,
    enabled: Boolean(a.enabled || b.enabled),
    analysisPostUseRating: Boolean(a.analysisPostUseRating || b.analysisPostUseRating),
    focusTracked: Boolean(a.focusTracked || b.focusTracked),
    taxonomyKey: a.taxonomyKey || b.taxonomyKey,
    acceptParentName: a.acceptParentName !== false && b.acceptParentName !== false,
    specs: [...specByName.values()],
  }
}

/**
 * 补全 dc/slb/vpc/eip 及用后即评 16 款（不覆盖已有配置，仅缺失字段/产品时合并）。
 * deletedKeys 中的种子产品 key 不会被强制补回或强制开启分析类型，尊重用户删除意图。
 * @param {CatalogProduct[]} products
 * @param {{ deletedKeys?: string[] }} [opts]
 */
export function ensureTargetProductsInCatalog(products, opts = {}) {
  // 与 resolveCatalogProduct 保持同一套归一化口径：key 比对不区分大小写与空格，
  // 否则线上填 `CC`、种子写 `cc` 会被判为两个产品，补一行出双份。
  const normKey = (value) => normalizeCatalogMatchText(value)
  const skipKeys = new Set((opts.deletedKeys || []).map(normKey).filter(Boolean))

  if (!Array.isArray(products)) {
    const seeds = structuredClone(ALL_CATALOG_SEED_PRODUCTS).filter(
      (p) => !skipKeys.has(normKey(p.key)),
    )
    return { products: seeds, changed: true }
  }

  /** @type {Map<string, CatalogProduct>} */
  const byKey = new Map(products.filter((p) => p?.key).map((p) => [normKey(p.key), structuredClone(p)]))
  let changed = false

  for (const seed of ALL_CATALOG_SEED_PRODUCTS) {
    const seedKey = normKey(seed.key)
    if (skipKeys.has(seedKey)) continue

    if (!byKey.has(seedKey)) {
      byKey.set(seedKey, structuredClone(seed))
      changed = true
      continue
    }
    const prev = byKey.get(seedKey)
    const merged = mergeCatalogProduct(prev, seed)
    // 对已有产品：若尚未设置用后即评开关且种子要求开启，则打开
    if (seed.analysisPostUseRating && !prev.analysisPostUseRating) {
      merged.analysisPostUseRating = true
    }
    if (seed.focusTracked && !prev.focusTracked) {
      merged.focusTracked = true
    }
    if (JSON.stringify(prev) !== JSON.stringify(merged)) {
      byKey.set(seedKey, merged)
      changed = true
    }
  }

  return { products: [...byKey.values()], changed }
}
