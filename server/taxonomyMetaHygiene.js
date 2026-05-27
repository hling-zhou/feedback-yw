import { syncCatalogProductsToTaxonomy } from '../src/lib/productCenterSync.js'
import { migrateBuiltinJourneysInSnapshot } from '../src/lib/tagLibrary/migrateBuiltinJourneys.js'
import { META_KEY_TAXONOMY_MANAGED } from '../src/lib/tagLibrary/taxonomyManageModel.js'
import { META_KEY_PRODUCT_CATALOG_MANAGED } from '../src/storage/productCatalogStore.js'
import { storageRepository } from './storageRepository.js'

/**
 * 注入 dc/slb/vpc 等内置用户旅程，并与产品目录对齐。
 * @param {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot}
 */
export function hydrateTaxonomyManagedSnapshot(snapshot) {
  const base = structuredClone(snapshot)
  migrateBuiltinJourneysInSnapshot(base)

  const catalogRaw = storageRepository.getMeta(META_KEY_PRODUCT_CATALOG_MANAGED)
  const products = catalogRaw?.products
  if (Array.isArray(products) && products.length) {
    return syncCatalogProductsToTaxonomy(base, products)
  }
  return base
}

/**
 * 读取并修复共享库 taxonomy_managed（供 API GET 与启动迁移使用）。
 * @returns {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot | null}
 */
export function readTaxonomyManagedMetaHydrated() {
  const raw = storageRepository.getMeta(META_KEY_TAXONOMY_MANAGED)
  if (!raw) return null
  if (!raw.products) return raw

  const hydrated = hydrateTaxonomyManagedSnapshot(
    /** @type {import('../src/lib/tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} */ (
      raw
    ),
  )

  try {
    if (JSON.stringify(hydrated) !== JSON.stringify(raw)) {
      hydrated.updatedAt = new Date().toISOString()
      hydrated.tagLibraryVersion =
        hydrated.tagLibraryVersion || `taxonomy-managed-${Date.now()}`
      storageRepository.putMeta(META_KEY_TAXONOMY_MANAGED, hydrated)
    }
  } catch {
    storageRepository.putMeta(META_KEY_TAXONOMY_MANAGED, hydrated)
  }

  return hydrated
}
