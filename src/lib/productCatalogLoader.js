/**
 * 目标产品与产品规格：优先 Excel，其次 JSON，最后内置默认
 */
import { parseProductCatalogWorkbook } from './productCatalogExcel.js'
import { SHARED_BANDWIDTH_SPEC } from './productCatalog/sharedBandwidthSpec.js'
import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'

const CONFIG_BASE = '/config/product-catalog'
const EXCEL_CONFIG_FILE = '产品规格配置.xlsx'
const JSON_CONFIG_FILE = 'product-catalog.json'

/**
 * @typedef {Object} ProductSpecDef
 * @property {string} name
 * @property {string[]} [match]
 */

/**
 * @typedef {Object} CatalogProduct
 * @property {string} key
 * @property {string} name
 * @property {boolean} enabled
 * @property {string} taxonomyKey
 * @property {boolean} [acceptParentName]
 * @property {ProductSpecDef[]} specs
 */

/**
 * @typedef {Object} ResolvedProduct
 * @property {boolean} inScope
 * @property {string} [productKey]
 * @property {string} [productName]
 * @property {string} [productSpec]
 * @property {string} [taxonomyKey]
 * @property {string} [reason]
 */

/** @type {CatalogProduct[]} */
const BUILTIN_PRODUCTS = [
  {
    key: 'eip',
    name: '弹性公网IP',
    enabled: true,
    taxonomyKey: 'eip',
    acceptParentName: true,
    specs: [
      {
        name: '弹性公网IP-移动IP',
        match: ['弹性公网IP-移动IP', '弹性公网 IP-移动IP', '弹性公网ip-移动ip'],
      },
      {
        name: '弹性公网IP-IPv6带宽',
        match: ['弹性公网IP-IPv6带宽', '弹性公网 IP-IPv6带宽', '弹性公网ip-ipv6带宽'],
      },
      SHARED_BANDWIDTH_SPEC,
    ],
  },
  { key: 'ecs', name: '云主机', enabled: false, taxonomyKey: 'ecs', acceptParentName: true, specs: [] },
  { key: 'evs', name: '云硬盘', enabled: false, taxonomyKey: 'evs', acceptParentName: true, specs: [] },
  { key: 'obs', name: '对象存储', enabled: false, taxonomyKey: 'obs', acceptParentName: true, specs: [] },
  { key: 'elb', name: '负载均衡', enabled: false, taxonomyKey: 'elb', acceptParentName: true, specs: [] },
  { key: 'rds', name: '云数据库', enabled: false, taxonomyKey: 'rds', acceptParentName: true, specs: [] },
  {
    key: 'vpc',
    name: '虚拟私有云',
    enabled: true,
    taxonomyKey: 'vpc',
    acceptParentName: true,
    specs: [
      {
        name: '虚拟私有云',
        match: ['虚拟私有云', 'VPC', 'vpc', '专有网络', '私有网络'],
      },
    ],
  },
  { key: 'cdn', name: '内容分发网络', enabled: false, taxonomyKey: 'cdn', acceptParentName: true, specs: [] },
]

/** @type {{ loadedAt: string | null; source: 'excel' | 'json' | 'builtin'; configFile: string; products: CatalogProduct[] }} */
let cache = {
  loadedAt: null,
  source: 'builtin',
  configFile: '内置',
  products: structuredClone(BUILTIN_PRODUCTS),
}

function cloneProducts(list) {
  return JSON.parse(JSON.stringify(list))
}

/**
 * @param {unknown} raw
 * @returns {CatalogProduct[] | null}
 */
function normalizeCatalogJson(raw) {
  if (!raw || typeof raw !== 'object') return null
  const products = /** @type {{ products?: CatalogProduct[] }} */ (raw).products
  if (!Array.isArray(products) || !products.length) return null
  return products
    .filter((p) => p?.key)
    .map((p) => ({
      key: p.key,
      name: p.name || p.key,
      enabled: Boolean(p.enabled),
      taxonomyKey: canonicalTaxonomyKey((p.taxonomyKey || p.key || '').trim() || p.key),
      acceptParentName: p.acceptParentName !== false,
      specs: (p.specs || []).map((s) => ({
        name: s.name,
        match: s.match?.length ? s.match : undefined,
      })),
    }))
}

async function loadFromExcel() {
  const url = `${CONFIG_BASE}/${encodeURIComponent(EXCEL_CONFIG_FILE)}?t=${Date.now()}`
  const res = await fetch(url)
  if (!res.ok) return null
  const buffer = await res.arrayBuffer()
  const { products } = parseProductCatalogWorkbook(buffer)
  if (!products.length) return null
  return { products, configFile: EXCEL_CONFIG_FILE }
}

async function loadFromJson() {
  const path = `${CONFIG_BASE}/${JSON_CONFIG_FILE}`
  const res = await fetch(`${path}?t=${Date.now()}`)
  if (!res.ok) return null
  const raw = await res.json()
  const products = normalizeCatalogJson(raw)
  if (!products?.length) return null
  return { products, configFile: `${CONFIG_BASE}/${JSON_CONFIG_FILE}`.replace(/^\//, '') }
}

/**
 * 将产品列表写入内存缓存（本机可编辑配置等）
 * @param {CatalogProduct[]} products
 * @param {{ source?: 'excel' | 'json' | 'builtin' | 'managed'; configFile?: string }} [meta]
 */
export function applyCatalogProducts(products, meta = {}) {
  cache = {
    loadedAt: new Date().toISOString(),
    source: meta.source || 'managed',
    configFile: meta.configFile || '本机可编辑配置',
    products: cloneProducts(products),
  }
  return getProductCatalogState()
}

/** 内置默认初始化（运行时 SSOT 为 product_catalog_managed_v1） */
export function initProductCatalogFromBuiltin() {
  cache = {
    loadedAt: new Date().toISOString(),
    source: 'builtin',
    configFile: '内置默认',
    products: cloneProducts(BUILTIN_PRODUCTS),
  }
  return getProductCatalogState()
}

/** @deprecated 请使用 initProductCatalogFromBuiltin + loadManagedProductCatalog */
export async function loadProductCatalogConfig() {
  return initProductCatalogFromBuiltin()
}

export function getProductCatalogState() {
  const enabled = cache.products.filter((p) => p.enabled)
  return {
    loadedAt: cache.loadedAt,
    source: cache.source,
    configFile: cache.configFile,
    productCount: cache.products.length,
    enabledCount: enabled.length,
    enabledNames: enabled.map((p) => p.name).join('、'),
  }
}

/** @returns {CatalogProduct[]} */
export function getCatalogProducts() {
  return cache.products
}

/** @returns {CatalogProduct[]} */
export function getEnabledProducts() {
  return cache.products.filter((p) => p.enabled)
}

/**
 * @param {string} [productKey]
 * @returns {CatalogProduct | undefined}
 */
export function getCatalogProduct(productKey) {
  return cache.products.find((p) => p.key === productKey)
}
