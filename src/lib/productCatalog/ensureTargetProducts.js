/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */

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
    taxonomyKey: 'dc',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'slb',
    name: '弹性负载均衡',
    enabled: true,
    taxonomyKey: 'slb',
    acceptParentName: true,
    specs: [],
  },
  {
    key: 'vpc',
    name: '虚拟私有云',
    enabled: true,
    taxonomyKey: 'vpc',
    acceptParentName: true,
    specs: [
      {
        name: '虚拟私有云',
        match: ['虚拟私有云', 'VPC', 'vpc', '专有网络', '私有网络'],
      },
    ],
  },
]

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
    taxonomyKey: a.taxonomyKey || b.taxonomyKey,
    acceptParentName: a.acceptParentName !== false && b.acceptParentName !== false,
    specs: [...specByName.values()],
  }
}

/**
 * 补全 dc / slb / vpc 等目标产品（不覆盖已有配置，仅缺失时插入）
 * @param {CatalogProduct[]} products
 */
export function ensureTargetProductsInCatalog(products) {
  if (!Array.isArray(products)) {
    return { products: structuredClone(TARGET_CATALOG_SEED_PRODUCTS), changed: true }
  }

  /** @type {Map<string, CatalogProduct>} */
  const byKey = new Map(products.filter((p) => p?.key).map((p) => [p.key, structuredClone(p)]))
  let changed = false

  for (const seed of TARGET_CATALOG_SEED_PRODUCTS) {
    if (!byKey.has(seed.key)) {
      byKey.set(seed.key, structuredClone(seed))
      changed = true
      continue
    }
    const merged = mergeCatalogProduct(byKey.get(seed.key), seed)
    const prev = byKey.get(seed.key)
    if (JSON.stringify(prev) !== JSON.stringify(merged)) {
      byKey.set(seed.key, merged)
      changed = true
    }
  }

  return { products: [...byKey.values()], changed }
}
