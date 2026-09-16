/** @typedef {import('../productCatalogLoader.js').CatalogProduct} CatalogProduct */
/** @typedef {import('../productCatalogLoader.js').ProductSpecDef} ProductSpecDef */

import { SPEC_MERGE_RULES, applySpecMergeRules } from './specMergeRules.js'

export {
  SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY,
  SHARED_BANDWIDTH_SPEC,
  SHARED_BANDWIDTH_SPEC_NAME,
} from './specMergeRules.js'

/**
 * 将独立产品「共享带宽」合并为弹性公网 IP 的一个规格。
 * 实现在 specMergeRules.js 的通用规则引擎中，这里只取共享带宽这一条规则，
 * 保持原有调用方语义（只处理共享带宽，不牵连其它合并规则）。
 * @param {CatalogProduct[]} products
 * @returns {{ products: CatalogProduct[]; changed: boolean }}
 */
export function mergeSharedBandwidthIntoEipCatalog(products) {
  const rule = SPEC_MERGE_RULES.find((r) => r.id === 'shared_bw_to_eip')
  if (!rule) return { products, changed: false }
  return applySpecMergeRules(products, [rule])
}
