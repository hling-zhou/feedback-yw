import {
  normalizeCatalogProducts,
  validateCatalogProducts,
  mergeCatalogByKey,
  parseCatalogImportFile,
} from '../lib/productCatalogManageModel.js'
import { mergeSharedBandwidthIntoEipCatalog } from '../lib/productCatalog/sharedBandwidthSpec.js'
import { ensureTargetProductsInCatalog } from '../lib/productCatalog/ensureTargetProducts.js'
import { migrateProductCatalogKeys } from '../lib/migrateProductCatalogKeys.js'
import {
  applyCatalogProducts,
  getCatalogProducts,
  initProductCatalogFromBuiltin,
} from '../lib/productCatalogLoader.js'

export const META_KEY_PRODUCT_CATALOG_MANAGED = 'product_catalog_managed_v1'

async function normalizeManagedCatalogProducts(products, opts = {}) {
  const { products: migrated, changed: keysChanged } = migrateProductCatalogKeys(products)
  const { products: withTargets, changed: targetsChanged } =
    ensureTargetProductsInCatalog(migrated, { deletedKeys: opts.deletedKeys })
  const { products: merged, changed: bwChanged } =
    mergeSharedBandwidthIntoEipCatalog(withTargets)
  return { products: merged, changed: keysChanged || targetsChanged || bwChanged }
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../lib/productCatalogLoader.js').CatalogProduct[]} products
 * @param {string[]} [deletedKeys]
 */
async function persistManagedCatalogIfChanged(adapter, products, changed, deletedKeys = []) {
  if (!changed) return products
  const snap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    products,
    deletedKeys,
  }
  await adapter.putMeta(META_KEY_PRODUCT_CATALOG_MANAGED, snap)
  return products
}

/**
 * @typedef {Object} ProductCatalogManagedSnapshot
 * @property {number} version
 * @property {string} updatedAt
 * @property {import('../lib/productCatalogLoader.js').CatalogProduct[]} products
 */

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function loadManagedProductCatalog(adapter) {
  await adapter.init?.()
  const snap = await adapter.getMeta(META_KEY_PRODUCT_CATALOG_MANAGED)
  if (!snap?.products?.length) return null
  const normalized = normalizeCatalogProducts(snap.products)
  const deletedKeys = Array.isArray(snap.deletedKeys) ? snap.deletedKeys : []
  const { products, changed } = await normalizeManagedCatalogProducts(normalized, { deletedKeys })
  await persistManagedCatalogIfChanged(adapter, products, changed, deletedKeys)
  return applyCatalogProducts(products, {
    source: 'managed',
    configFile: '本机可编辑配置',
  })
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../lib/productCatalogLoader.js').CatalogProduct[]} products
 * @param {{ deletedKeys?: string[] }} [opts]
 */
export async function saveManagedProductCatalog(adapter, products, opts = {}) {
  const normalized = normalizeCatalogProducts(products)
  validateCatalogProducts(normalized)
  const deletedKeys = Array.isArray(opts.deletedKeys) ? opts.deletedKeys : []
  const snap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    products: normalized,
    deletedKeys,
  }
  await adapter.putMeta(META_KEY_PRODUCT_CATALOG_MANAGED, snap)
  return applyCatalogProducts(normalized, {
    source: 'managed',
    configFile: '本机可编辑配置',
  })
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @returns {Promise<ProductCatalogManagedSnapshot>}
 */
export async function getOrInitManagedProductCatalogSnapshot(adapter) {
  await adapter.init?.()
  const existing = await adapter.getMeta(META_KEY_PRODUCT_CATALOG_MANAGED)
  if (existing?.products?.length) {
    const normalized = normalizeCatalogProducts(existing.products)
    const deletedKeys = Array.isArray(existing.deletedKeys) ? existing.deletedKeys : []
    const { products, changed } = await normalizeManagedCatalogProducts(normalized, { deletedKeys })
    await persistManagedCatalogIfChanged(adapter, products, changed, deletedKeys)
    return /** @type {ProductCatalogManagedSnapshot} */ ({
      version: 1,
      updatedAt: new Date().toISOString(),
      products,
      deletedKeys,
    })
  }

  initProductCatalogFromBuiltin()
  const products = structuredClone(getCatalogProducts())
  const snap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    products,
    deletedKeys: [],
  }
  await adapter.putMeta(META_KEY_PRODUCT_CATALOG_MANAGED, snap)
  return snap
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../lib/productCatalogLoader.js').CatalogProduct[]} incoming
 * @param {{ replace?: boolean }} [opts]
 */
export async function importManagedProductCatalog(adapter, incoming, opts = {}) {
  const snap = await getOrInitManagedProductCatalogSnapshot(adapter)
  const { products, added, updated } = mergeCatalogByKey(snap.products, incoming, opts)
  const prevDeletedKeys = Array.isArray(snap.deletedKeys) ? snap.deletedKeys : []
  // 导入的产品 key 从 deletedKeys 中移除（用户主动重新导入 = 恢复种子产品）
  const incomingKeys = new Set(
    (Array.isArray(incoming) ? incoming : []).map((p) => String(p?.key || '').trim()).filter(Boolean),
  )
  const deletedKeys = prevDeletedKeys.filter((k) => !incomingKeys.has(k))
  await saveManagedProductCatalog(adapter, products, { deletedKeys })
  return { products, added, updated }
}

const PRODUCT_CATALOG_CONFIG_BASE = '/config/product-catalog'
const PRODUCT_CATALOG_EXCEL_FILE = '产品规格配置.xlsx'

/**
 * 从 public/config/product-catalog/产品规格配置.xlsx 按 Key 合并导入到共享库。
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function importManagedProductCatalogFromConfigExcel(adapter) {
  const url = `${PRODUCT_CATALOG_CONFIG_BASE}/${encodeURIComponent(PRODUCT_CATALOG_EXCEL_FILE)}?t=${Date.now()}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(
      `未找到 ${PRODUCT_CATALOG_EXCEL_FILE}（请确认 public/config/product-catalog/ 下存在该文件）`,
    )
  }
  const incoming = parseCatalogImportFile(await res.arrayBuffer())
  return importManagedProductCatalog(adapter, incoming)
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function clearManagedProductCatalog(adapter) {
  await adapter.putMeta(META_KEY_PRODUCT_CATALOG_MANAGED, null)
}
