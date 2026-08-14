/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */

/**
 * @param {unknown} value
 */
export function normalizeCatalogMatchText(value) {
  return String(value ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/[－—–]/g, '-')
    .toLowerCase()
}

/**
 * 按给定产品列表解析记录上的产品字段：key、名称、规格名、规格别名精确对照。
 * 不做开关过滤，由调用方传入已筛选的产品。
 * @param {Record<string, unknown> | string | null | undefined} recordOrName
 * @param {CatalogProduct[] | null | undefined} products
 * @returns {CatalogProduct | null}
 */
export function resolveCatalogProduct(recordOrName, products) {
  const list = Array.isArray(products) ? products.filter(Boolean) : []
  if (!list.length) return null
  const record = typeof recordOrName === 'string' ? { productName: recordOrName } : recordOrName || {}
  const rawKey = normalizeCatalogMatchText(record.productKey)
  if (rawKey) {
    const keyed = list.find((product) => normalizeCatalogMatchText(product.key) === rawKey)
    if (keyed) return keyed
  }

  const rawValues = [record.productName, record.product, record.productSpec]
    .map(normalizeCatalogMatchText)
    .filter(Boolean)
  if (!rawValues.length) return null

  for (const product of list) {
    const candidates = [
      product.name,
      product.key,
      ...(product.specs || []).flatMap((spec) => [spec.name, ...(spec.match || [])]),
    ]
      .map(normalizeCatalogMatchText)
      .filter(Boolean)
    if (rawValues.some((raw) => candidates.some((candidate) => raw === candidate))) return product
  }

  return null
}

/**
 * @template {Record<string, unknown>} T
 * @param {T} record
 * @param {CatalogProduct} product
 * @returns {T}
 */
export function canonicalizeRecordProduct(record, product) {
  return {
    ...record,
    productKey: product.key,
    product: product.name,
    productName: product.name,
  }
}
