import {
  getCatalogProducts,
  getEnabledProducts,
  getCatalogProduct,
  loadProductCatalogConfig,
  getProductCatalogState,
} from './productCatalogLoader.js'
import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'

export {
  loadProductCatalogConfig,
  getProductCatalogState,
  getCatalogProducts,
  getEnabledProducts,
  getCatalogProduct,
}

/**
 * @param {string} [text]
 */
export function normalizeProductText(text) {
  return (text || '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[－—–]/g, '-')
    .toLowerCase()
}

/**
 * @param {string} raw
 * @param {string} target
 */
function textMatches(raw, target) {
  const a = normalizeProductText(raw)
  const b = normalizeProductText(target)
  if (!a || !b) return false
  return a === b || a.includes(b) || b.includes(a)
}

/**
 * 将工单中的「产品规格」列解析为目标产品与规格
 * @param {string} [specRaw] - 导入列原始值（原「具体投诉产品」）
 * @returns {import('./productCatalogLoader.js').ResolvedProduct}
 */
export function resolveProductFromSpec(specRaw) {
  const raw = specRaw?.trim()
  if (!raw) {
    return { inScope: false, reason: '缺少产品规格' }
  }

  for (const product of getEnabledProducts()) {
    for (const spec of product.specs || []) {
      const candidates = [spec.name, ...(spec.match || [])]
      if (candidates.some((c) => textMatches(raw, c))) {
        return {
          inScope: true,
          productKey: product.key,
          productName: product.name,
          productSpec: spec.name,
          taxonomyKey: canonicalTaxonomyKey(product.taxonomyKey || product.key),
        }
      }
    }

    if (product.acceptParentName !== false) {
      const parentCandidates = [product.name, product.key]
      if (parentCandidates.some((c) => textMatches(raw, c))) {
        return {
          inScope: true,
          productKey: product.key,
          productName: product.name,
          productSpec: raw,
          taxonomyKey: canonicalTaxonomyKey(product.taxonomyKey || product.key),
        }
      }
    }
  }

  return {
    inScope: false,
    reason: `不在目标产品范围：${raw}`,
  }
}

/**
 * @param {Record<string, string>} row
 */
export function getRowProductSpecRaw(row) {
  return row.productSpec?.trim() || row.product?.trim() || ''
}

/**
 * @param {Record<string, string>[]} rows
 */
export function partitionRowsByProductCatalog(rows) {
  /** @type {Record<string, string>[]} */
  const inScope = []
  /** @type {{ row: Record<string, string>; reason: string }[]} */
  const skipped = []

  for (const row of rows) {
    const specRaw = getRowProductSpecRaw(row)
    const resolved = resolveProductFromSpec(specRaw)
    if (resolved.inScope) {
      inScope.push({
        ...row,
        product: resolved.productName,
        productSpec: resolved.productSpec,
        productKey: resolved.productKey,
      })
    } else {
      skipped.push({
        row,
        reason: resolved.reason || '不在目标产品范围',
      })
    }
  }

  const enabledNames = getEnabledProducts().map((p) => p.name).join('、')

  return {
    inScope,
    skipped,
    stats: {
      total: rows.length,
      accepted: inScope.length,
      skipped: skipped.length,
      enabledProductNames: enabledNames,
    },
  }
}

/**
 * @param {import('./types.js').FeedbackRecord} fb
 */
export function resolveRecordProduct(fb) {
  const specRaw = fb.productSpec?.trim() || fb.product?.trim() || ''
  const resolved = resolveProductFromSpec(specRaw)
  if (resolved.inScope) return resolved
  return {
    inScope: true,
    productKey: fb.productKey || 'generic',
    productName: fb.product?.trim() || '未标注产品',
    productSpec: fb.productSpec || specRaw || undefined,
    taxonomyKey: fb.productKey || 'generic',
  }
}

/**
 * 供设置页展示：产品 → 规格列表
 */
export function getProductCatalogTable() {
  return getCatalogProducts().map((p) => ({
    key: p.key,
    name: p.name,
    enabled: p.enabled,
    specs: (p.specs || []).map((s) => s.name),
    taxonomyKey: p.taxonomyKey,
  }))
}

/** @returns {Map<string, string>} productKey → 目标产品名称 */
export function buildProductNameByKeyMap() {
  return new Map(getCatalogProducts().map((p) => [p.key, p.name]))
}
