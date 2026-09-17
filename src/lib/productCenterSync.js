/** @typedef {import('./productCatalogLoader.js').CatalogProduct} CatalogProduct */
/** @typedef {import('./tagLibrary/taxonomyManageModel.js').TaxonomyManagedSnapshot} TaxonomyManagedSnapshot */

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function journeysEqual(a, b) {
  try {
    return JSON.stringify(a) === JSON.stringify(b)
  } catch {
    return false
  }
}

/**
 * @param {TaxonomyManagedSnapshot['products'][string]} tax
 * @param {unknown} [genericJourneys]
 */
export function normalizeProvisionedTemplate(tax, genericJourneys) {
  if (tax.journeyConfigured === true) return tax

  if (tax.journeyConfigured === undefined && tax.journeys?.length) {
    const clonedFromGeneric =
      genericJourneys?.length && journeysEqual(tax.journeys, genericJourneys)
    if (!clonedFromGeneric) {
      return { ...tax, journeyConfigured: true, catalogProvisioned: false }
    }
  }

  return {
    ...tax,
    journeys: [],
    catalogProvisioned: true,
    journeyConfigured: false,
  }
}

/**
 * 在标签库快照中确保存在旅程模板产品（环节始终为空，由用户在「旅程环节标签」中维护）
 * @param {TaxonomyManagedSnapshot} snapshot
 * @param {Object} params
 * @param {string} params.key
 * @param {string} params.name
 * @param {string[]} [params.match]
 */
export function ensureTaxonomyProduct(snapshot, { key, name, match = [] }) {
  const k = key?.trim()
  if (!k) throw new Error('旅程模板 Key 不能为空')
  if (snapshot.products[k]) return snapshot

  snapshot.products[k] = {
    key: k,
    name: name?.trim() || k,
    match: match.length ? match : [name?.trim() || k],
    journeys: [],
    catalogProvisioned: true,
    journeyConfigured: false,
  }
  return snapshot
}

/**
 * 用户在「旅程环节标签」保存后标记模板已手工配置
 * @param {TaxonomyManagedSnapshot} snapshot
 * @param {string} productKey
 */
export function markJourneyConfigured(snapshot, productKey) {
  const k = productKey?.trim()
  const tax = snapshot.products?.[k]
  if (!tax) return snapshot
  tax.journeyConfigured = true
  tax.catalogProvisioned = false
  return snapshot
}

import { canonicalTaxonomyKey } from './taxonomyKeyAliases.js'
import { migrateBuiltinJourneysInSnapshot } from './tagLibrary/migrateBuiltinJourneys.js'
import { sanitizeProductKey } from './productCatalog/keyHygiene.js'

const PROTECTED_TAXONOMY_KEYS = new Set([
  'generic',
  'eip',
  'dc',
  'slb',
  'vpc',
  'vpc_endpoint',
])

/** 内置旅程产品：目录同步时勿清空环节（由 migrateBuiltinJourneys 注入） */
const BUILTIN_JOURNEY_TAXONOMY_KEYS = new Set([
  'eip',
  'dc',
  'slb',
  'vpc',
  'vpc_endpoint',
])

/**
 * 根据产品规格表同步旅程模板：自动创建、更新名称/匹配词、删除已无产品引用的模板。
 *
 * **显示名保护**：产品目录到旅程模板是多对一关系（例如 `shared_bw`（共享带宽）与
 * `eip`（弹性公网IP）都归到 `eip` 模板）。模板的显示名只能由「自身 key 就等于模板 key」
 * 的那条目录记录（owner）决定；兄弟记录（借道 taxonomyKey 归并过来的产品）只贡献
 * 匹配词，绝不覆盖模板名 —— 否则会出现「弹性公网IP 的模板名被写成共享带宽」这类张冠李戴。
 *
 * @param {TaxonomyManagedSnapshot} snapshot
 * @param {CatalogProduct[]} catalogProducts
 */
export function syncCatalogProductsToTaxonomy(snapshot, catalogProducts) {
  const next = structuredClone(snapshot)
  const genericJourneys = next.products.generic?.journeys

  for (const p of catalogProducts) {
    const ownKey = sanitizeProductKey(p.key)
    const tKey = canonicalTaxonomyKey(
      sanitizeProductKey(p.taxonomyKey || p.key || '') || ownKey,
    )
    if (!tKey) continue

    const match = [p.name, ownKey, tKey].filter(Boolean)
    if (next.products[tKey]) {
      next.products[tKey] = normalizeProvisionedTemplate(next.products[tKey], genericJourneys)
      // 仅 owner（产品自身 key 等于模板 key）可设显示名；兄弟记录只贡献匹配词
      if (ownKey === tKey && p.name?.trim()) {
        next.products[tKey].name = p.name.trim()
      }
      next.products[tKey].match = match.length ? [...new Set(match)] : [tKey]
      if (
        !next.products[tKey].journeyConfigured &&
        !BUILTIN_JOURNEY_TAXONOMY_KEYS.has(tKey)
      ) {
        next.products[tKey].journeys = []
      }
      continue
    }

    ensureTaxonomyProduct(next, {
      key: tKey,
      name: ownKey === tKey ? (p.name || tKey) : tKey,
      match,
    })
  }

  const referenced = new Set(
    catalogProducts.flatMap((p) => {
      const catalogKey = sanitizeProductKey(p.key)
      const taxKey = canonicalTaxonomyKey(
        sanitizeProductKey(p.taxonomyKey || p.key || '') || catalogKey,
      )
      return [catalogKey, taxKey].filter(Boolean)
    }),
  )
  for (const key of Object.keys(next.products)) {
    if (PROTECTED_TAXONOMY_KEYS.has(key)) continue
    if (!referenced.has(key)) delete next.products[key]
  }

  migrateBuiltinJourneysInSnapshot(next)
  return next
}

const TAXONOMY_SNAPSHOT_VOLATILE_KEYS = new Set(['updatedAt', 'tagLibraryVersion'])

/**
 * @param {unknown} value
 * @returns {string}
 */
function stableSerialize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map((item) => stableSerialize(item)).join(',')}]`
  const keys = Object.keys(value)
    .filter((key) => !TAXONOMY_SNAPSHOT_VOLATILE_KEYS.has(key))
    .sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`).join(',')}}`
}

/**
 * 比较标签库快照内容，忽略 updatedAt / tagLibraryVersion。
 * @param {unknown} a
 * @param {unknown} b
 */
export function taxonomySnapshotContentEqual(a, b) {
  if (a === b) return true
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false
  try {
    return stableSerialize(a) === stableSerialize(b)
  } catch {
    return false
  }
}

/**
 * @param {TaxonomyManagedSnapshot} snapshot
 * @param {string} productKey
 */
export function removeTaxonomyProduct(snapshot, productKey) {
  const k = productKey?.trim()
  if (!k) return snapshot
  if (k === 'generic') {
    throw new Error('不能删除通用模板 generic')
  }
  const next = structuredClone(snapshot)
  delete next.products[k]
  return next
}

/**
 * @param {CatalogProduct[]} catalogProducts
 * @param {string} taxonomyKey
 */
export function countCatalogRefsToTaxonomyKey(catalogProducts, taxonomyKey) {
  const target = canonicalTaxonomyKey(taxonomyKey)
  return catalogProducts.filter(
    (p) => canonicalTaxonomyKey(p.taxonomyKey || p.key) === target,
  ).length
}
