import {
  SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY,
  SHARED_BANDWIDTH_SPEC_NAME,
  mergeSharedBandwidthIntoEipCatalog,
} from '../productCatalog/sharedBandwidthSpec.js'

/**
 * 移除 taxonomy 中独立的「共享带宽」产品（旅程统一走 eip）。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateSharedBandwidthTaxonomyProduct(snapshot) {
  if (!snapshot?.products?.[SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY]) return false
  delete snapshot.products[SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY]
  return true
}

/**
 * @param {import('../../storage/types.js').FeedbackRecord} record
 * @returns {boolean}
 */
export function migrateSharedBandwidthRecordToEip(record) {
  if (!record) return false
  let changed = false

  const pk = record.productKey?.trim()
  const tk = record.taxonomyKey?.trim()
  const product = record.product?.trim()
  const spec = record.productSpec?.trim()

  const isLegacyProduct =
    pk === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY ||
    tk === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY

  if (isLegacyProduct) {
    record.productKey = 'eip'
    record.taxonomyKey = 'eip'
    changed = true
  }

  if (
    product === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY ||
    (!product && spec === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY)
  ) {
    record.product = '弹性公网IP'
    changed = true
  }

  if (
    spec === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY ||
    spec === SHARED_BANDWIDTH_SPEC_NAME ||
    (!spec && product === SHARED_BANDWIDTH_LEGACY_PRODUCT_KEY)
  ) {
    record.productSpec = SHARED_BANDWIDTH_SPEC_NAME
    changed = true
  }

  return changed
}

export { mergeSharedBandwidthIntoEipCatalog }
