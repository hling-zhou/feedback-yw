/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */
/** @typedef {import('../productCatalogLoader.js').ProductSpecDef} ProductSpecDef */

export const SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY = '共享带宽'

export const SHARED_BANDWIDTH_SPEC_NAME = '弹性公网IP-共享带宽'

/** @type {ProductSpecDef} */
export const SHARED_BANDWIDTH_SPEC = {
  name: SHARED_BANDWIDTH_SPEC_NAME,
  match: [
    '共享带宽',
    '弹性公网IP-共享带宽',
    '弹性公网 IP-共享带宽',
    '弹性公网ip-共享带宽',
    '弹性公网IP共享带宽',
  ],
}

/**
 * 将独立产品「共享带宽」合并为弹性公网 IP 的一个规格。
 * @param {CatalogProduct[]} products
 * @returns {{ products: CatalogProduct[]; changed: boolean }}
 */
export function mergeSharedBandwidthIntoEipCatalog(products) {
  const list = structuredClone(products)
  const legacyIdx = list.findIndex((p) => p.key === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY)
  const eipIdx = list.findIndex((p) => p.key === 'eip')
  if (eipIdx < 0) return { products: list, changed: false }

  let changed = false
  const eip = list[eipIdx]
  const hasSpec = (eip.specs || []).some(
    (s) =>
      s.name === SHARED_BANDWIDTH_SPEC_NAME ||
      s.name === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY ||
      (s.match || []).includes(SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY),
  )
  if (!hasSpec) {
    eip.specs = [...(eip.specs || []), { ...SHARED_BANDWIDTH_SPEC }]
    changed = true
  }

  if (legacyIdx >= 0 && legacyIdx !== eipIdx) {
    list.splice(legacyIdx, 1)
    changed = true
  }

  if (changed) {
    list[eipIdx] = eip
  }
  return { products: list, changed }
}
