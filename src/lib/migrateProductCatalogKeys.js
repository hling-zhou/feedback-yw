import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'
import { stripInvisibleChars } from './productCatalog/keyHygiene.js'

/** @typedef {import('./productCatalogLoader.js').CatalogProduct} CatalogProduct */

/**
 * 已知误配纠偏：目录 key → 该记录必须使用的 taxonomyKey。
 *
 * `vpc_endpoint`（VPC终端节点）历史上借道了 `vpc` 模板，导致每轮
 * `syncCatalogProductsToTaxonomy` 都把兄弟项三元组 `['VPC终端节点','vpc_endpoint','vpc']`
 * 写进 `vpc.match`，而 `resolveTaxonomyKey` 最长匹配等长时取先定义者，
 * 「VPC终端节点」被判成 `vpc` —— 终端节点工单被归到「虚拟私有云」。
 *
 * 为什么不改种子：`mergeCatalogProduct` 是「已有值优先」，改 `postUseRatingProducts.js`
 * 的种子覆盖不到库中已存在的记录，必须在此纠偏。纠正后条件不再成立，天然幂等。
 */
const REQUIRED_TAXONOMY_KEYS = {
  vpc_endpoint: 'vpc_endpoint',
}

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
    analysisPostUseRating: Boolean(a.analysisPostUseRating || b.analysisPostUseRating),
    focusTracked: Boolean(
      (a.analysisPostUseRating && a.focusTracked) ||
        (b.analysisPostUseRating && b.focusTracked),
    ),
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
    // 迁移路径剥离零宽字符（历史录入的 CloudDNS\u200C 等），录入路径由 validateProductKey 报错拦截
    const key = canonicalTaxonomyKey(stripInvisibleChars(origKey))
    const requiredTax = REQUIRED_TAXONOMY_KEYS[key]
    const taxonomyKey = canonicalTaxonomyKey(
      requiredTax || stripInvisibleChars(origTax || origKey),
    )
    if (key !== origKey || taxonomyKey !== origTax) changed = true

    const normalized = {
      key,
      name: String(raw.name || key).trim(),
      enabled: Boolean(raw.enabled),
      analysisPostUseRating: Boolean(raw.analysisPostUseRating),
      focusTracked: Boolean(raw.analysisPostUseRating && raw.focusTracked),
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
