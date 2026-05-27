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

const PROTECTED_TAXONOMY_KEYS = new Set(['generic', 'eip', 'dc', 'slb', 'vpc'])

/** 内置旅程产品：目录同步时勿清空环节（由 migrateBuiltinJourneys 注入） */
const BUILTIN_JOURNEY_TAXONOMY_KEYS = new Set(['eip', 'dc', 'slb', 'vpc'])

/**
 * 根据产品规格表同步旅程模板：自动创建、更新名称/匹配词、删除已无产品引用的模板
 * @param {TaxonomyManagedSnapshot} snapshot
 * @param {CatalogProduct[]} catalogProducts
 */
export function syncCatalogProductsToTaxonomy(snapshot, catalogProducts) {
  const next = structuredClone(snapshot)
  const genericJourneys = next.products.generic?.journeys

  for (const p of catalogProducts) {
    const tKey = canonicalTaxonomyKey((p.taxonomyKey || p.key || '').trim())
    if (!tKey) continue

    const match = [p.name, p.key, tKey].filter(Boolean)
    if (next.products[tKey]) {
      next.products[tKey] = normalizeProvisionedTemplate(next.products[tKey], genericJourneys)
      next.products[tKey].name = p.name?.trim() || tKey
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
      name: p.name || tKey,
      match,
    })
  }

  const referenced = new Set(
    catalogProducts.flatMap((p) => {
      const catalogKey = (p.key || '').trim()
      const taxKey = canonicalTaxonomyKey((p.taxonomyKey || p.key || '').trim())
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
