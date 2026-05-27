import {
  normalizeCatalogProducts,
  validateCatalogProducts,
  mergeCatalogByKey,
  parseCatalogImportFile,
} from '../lib/productCatalogManageModel.js'
import { mergeSharedBandwidthIntoEipCatalog } from '../lib/productCatalog/sharedBandwidthSpec.js'
import { migrateProductCatalogKeys } from '../lib/migrateProductCatalogKeys.js'
import {
  applyCatalogProducts,
  getCatalogProducts,
  initProductCatalogFromBuiltin,
} from '../lib/productCatalogLoader.js'

export const META_KEY_PRODUCT_CATALOG_MANAGED = 'product_catalog_managed_v1'

async function normalizeManagedCatalogProducts(products) {
  const { products: migrated, changed: keysChanged } = migrateProductCatalogKeys(products)
  const { products: merged, changed: bwChanged } = mergeSharedBandwidthIntoEipCatalog(migrated)
  return { products: merged, changed: keysChanged || bwChanged }
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../lib/productCatalogLoader.js').CatalogProduct[]} products
 */
async function persistManagedCatalogIfChanged(adapter, products, changed) {
  if (!changed) return products
  const snap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    products,
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
  const { products, changed } = await normalizeManagedCatalogProducts(normalized)
  await persistManagedCatalogIfChanged(adapter, products, changed)
  return applyCatalogProducts(products, {
    source: 'managed',
    configFile: '本机可编辑配置',
  })
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('../lib/productCatalogLoader.js').CatalogProduct[]} products
 */
export async function saveManagedProductCatalog(adapter, products) {
  const normalized = normalizeCatalogProducts(products)
  validateCatalogProducts(normalized)
  const snap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    products: normalized,
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
    const { products, changed } = await normalizeManagedCatalogProducts(normalized)
    await persistManagedCatalogIfChanged(adapter, products, changed)
    return /** @type {ProductCatalogManagedSnapshot} */ ({
      version: 1,
      updatedAt: new Date().toISOString(),
      products,
    })
  }

  initProductCatalogFromBuiltin()
  const products = structuredClone(getCatalogProducts())
  const snap = {
    version: 1,
    updatedAt: new Date().toISOString(),
    products,
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
  await saveManagedProductCatalog(adapter, products)
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
