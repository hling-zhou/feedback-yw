import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'

/** @typedef {import('./productCatalogLoader.js').CatalogProduct} CatalogProduct */

/**
 * @param {CatalogProduct} a
 * @param {CatalogProduct} b
 */
function mergeCatalogProduct(a, b) {
  const specByName = new Map((a.specs || []).map((s) => [s.name, { ...s }]))
  for (const spec of b.specs || []) {
    if (!specByName.has(spec.name)) {
      specByName.set(spec.name, { ...spec })
      continue
    }
    const prev = specByName.get(spec.name)
    const merged = new Set([...(prev.match || []), ...(spec.match || [])])
    if (merged.size) prev.match = [...merged]
  }
  return {
    ...a,
    name: a.name?.trim() || b.name?.trim() || a.key,
    enabled: Boolean(a.enabled || b.enabled),
    taxonomyKey: canonicalTaxonomyKey(a.taxonomyKey || a.key),
    acceptParentName: a.acceptParentName !== false && b.acceptParentName !== false,
    specs: [...specByName.values()],
  }
}

/**
 * 将托管产品目录中的旧 key（ecc、SLB 等）迁移为 dc、slb，并合并重复项。
 * @param {CatalogProduct[]} products
 */
export function migrateProductCatalogKeys(products) {
  if (!Array.isArray(products) || !products.length) {
    return { products: [], changed: false }
  }

  let changed = false
  /** @type {Map<string, CatalogProduct>} */
  const byKey = new Map()

  for (const raw of products) {
    if (!raw?.key) continue
    const origKey = String(raw.key).trim()
    const origTax = String(raw.taxonomyKey || origKey).trim()
    const key = canonicalTaxonomyKey(origKey)
    const taxonomyKey = canonicalTaxonomyKey(origTax || origKey)
    if (key !== origKey || taxonomyKey !== origTax) changed = true

    const normalized = {
      key,
      name: String(raw.name || key).trim(),
      enabled: Boolean(raw.enabled),
      taxonomyKey,
      acceptParentName: raw.acceptParentName !== false,
      specs: (raw.specs || [])
        .filter((s) => s?.name)
        .map((s) => ({
          name: String(s.name).trim(),
          match: Array.isArray(s.match)
            ? s.match.map((m) => String(m).trim()).filter(Boolean)
            : undefined,
        })),
    }

    if (byKey.has(key)) {
      byKey.set(key, mergeCatalogProduct(byKey.get(key), normalized))
      changed = true
    } else {
      byKey.set(key, normalized)
    }
  }

  const result = [...byKey.values()]
  if (result.length !== products.length) changed = true
  return { products: result, changed }
}
