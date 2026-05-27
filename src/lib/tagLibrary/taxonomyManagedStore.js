import { buildOverridePatchFromCandidate } from '../taxonomyLoader.js'
import {
  applyManagedTaxonomySnapshot,
  buildSnapshotFromCache,
  initTaxonomyCacheFromBuiltin,
} from '../taxonomyLoader.js'
import { ensureBuiltinRequestScenesInSnapshot } from './ensureBuiltinRequestScenes.js'
import { syncCatalogProductsToTaxonomy } from '../productCenterSync.js'
import { migrateBuiltinJourneysInSnapshot } from './migrateBuiltinJourneys.js'
import { META_KEY_PRODUCT_CATALOG_MANAGED } from '../../storage/productCatalogStore.js'
import { migrateSharedBandwidthTaxonomyProduct } from './migrateSharedBandwidthToEip.js'
import { migrateSharedTagsInSnapshot } from './migrateSharedTags.js'
import {
  META_KEY_TAXONOMY_MANAGED,
  mergeImportByKey,
  validateTaxonomyImport,
} from './taxonomyManageModel.js'

async function persistManagedSnapshotIfNeeded(adapter, snapshot, changed) {
  if (!changed) return
  const next = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    tagLibraryVersion: snapshot.tagLibraryVersion || `taxonomy-managed-${Date.now()}`,
  }
  await adapter.putMeta(META_KEY_TAXONOMY_MANAGED, next)
  Object.assign(snapshot, next)
}

export { META_KEY_TAXONOMY_MANAGED }

/**
 * 修复托管标签库中的内置用户旅程（vpc/slb/dc），并与产品目录对齐后写回。
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function repairBuiltinTaxonomyJourneys(adapter) {
  const snapshot = structuredClone(
    /** @type {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} */ (
      await getOrInitManagedSnapshot(adapter)
    ),
  )
  migrateBuiltinJourneysInSnapshot(snapshot)
  const catalog = await adapter.getMeta(META_KEY_PRODUCT_CATALOG_MANAGED)
  const products = catalog?.products
  const next =
    Array.isArray(products) && products.length
      ? syncCatalogProductsToTaxonomy(snapshot, products)
      : snapshot
  return saveManagedTaxonomy(adapter, next)
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function loadManagedTaxonomy(adapter) {
  const snapshot = await adapter.getMeta(META_KEY_TAXONOMY_MANAGED)
  if (snapshot) {
    const normalized = structuredClone(
      /** @type {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} */ (snapshot),
    )
    let changed = ensureBuiltinRequestScenesInSnapshot(normalized)
    changed = migrateSharedBandwidthTaxonomyProduct(normalized) || changed
    changed = migrateBuiltinJourneysInSnapshot(normalized) || changed
    changed = migrateSharedTagsInSnapshot(normalized) || changed
    await persistManagedSnapshotIfNeeded(adapter, normalized, changed)
    return applyManagedTaxonomySnapshot(normalized)
  }
  return null
}

/**
 * @param {{ putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 */
export async function saveManagedTaxonomy(adapter, snapshot) {
  const next = {
    ...snapshot,
    updatedAt: new Date().toISOString(),
    tagLibraryVersion: snapshot.tagLibraryVersion || `taxonomy-managed-${Date.now()}`,
  }
  await adapter.putMeta(META_KEY_TAXONOMY_MANAGED, next)
  return applyManagedTaxonomySnapshot(next)
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function getOrInitManagedSnapshot(adapter) {
  const existing = await adapter.getMeta(META_KEY_TAXONOMY_MANAGED)
  if (existing) {
    const snapshot = structuredClone(
      /** @type {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} */ (existing),
    )
    let changed = ensureBuiltinRequestScenesInSnapshot(snapshot)
    changed = migrateSharedBandwidthTaxonomyProduct(snapshot) || changed
    changed = migrateBuiltinJourneysInSnapshot(snapshot) || changed
    changed = migrateSharedTagsInSnapshot(snapshot) || changed
    await persistManagedSnapshotIfNeeded(adapter, snapshot, changed)
    applyManagedTaxonomySnapshot(snapshot)
    return snapshot
  }
  initTaxonomyCacheFromBuiltin()
  const snapshot = buildSnapshotFromCache()
  ensureBuiltinRequestScenesInSnapshot(snapshot)
  migrateBuiltinJourneysInSnapshot(snapshot)
  await adapter.putMeta(META_KEY_TAXONOMY_MANAGED, snapshot)
  applyManagedTaxonomySnapshot(snapshot)
  return snapshot
}

/**
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @param {import('../domain/tagCandidate.js').TagCandidate} candidate
 */
export function mergeCandidateIntoSnapshot(snapshot, candidate) {
  const patch = buildOverridePatchFromCandidate(candidate)
  if (!snapshot.sharedRequestScenes) snapshot.sharedRequestScenes = []
  const rsLabels = new Set((snapshot.sharedRequestScenes || []).map((t) => t.label))
  for (const rs of patch.requestScenes || []) {
    if (!rs.label?.trim() || rsLabels.has(rs.label)) continue
    snapshot.sharedRequestScenes.push({
      label: rs.label,
      keywords: rs.keywords || [],
    })
    rsLabels.add(rs.label)
  }

  const ptLabels = new Set((snapshot.sharedProblemTypes || []).map((t) => t.label))

  for (const pt of patch.problemTypes || []) {
    if (!pt.label?.trim() || ptLabels.has(pt.label)) continue
    snapshot.sharedProblemTypes.push({
      label: pt.label,
      keywords: pt.keywords || [],
    })
    ptLabels.add(pt.label)
  }

  const journeyKeys = new Set()
  for (const [pKey, tax] of Object.entries(snapshot.products || {})) {
    for (const l1 of tax.journeys || []) {
      for (const l2 of l1.children || []) {
        journeyKeys.add(`${pKey}::${l1.label}::${l2.label}`)
      }
    }
  }

  for (const jp of patch.journeyPatches || []) {
    const pKey = jp.taxonomyKey || 'generic'
    if (!snapshot.products[pKey]) {
      snapshot.products[pKey] = { key: pKey, name: pKey, match: [], journeys: [] }
    }
    const tax = snapshot.products[pKey]
    let l1Node = tax.journeys.find((j) => j.label === jp.journeyL1)
    if (!l1Node) {
      l1Node = {
        id: jp.journeyL1,
        label: jp.journeyL1,
        description: jp.description || '',
        children: [],
      }
      tax.journeys.push(l1Node)
    }
    const key = `${pKey}::${jp.journeyL1}::${jp.journeyL2}`
    if (journeyKeys.has(key)) continue
    l1Node.children.push({
      id: jp.journeyL2,
      label: jp.journeyL2,
      description: jp.description || '',
      keywords: jp.keywords || [],
    })
    journeyKeys.add(key)
  }

  snapshot.updatedAt = new Date().toISOString()
  return snapshot
}

/**
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 * @param {ArrayBuffer} buffer
 */
export async function importManagedTaxonomyIncremental(adapter, buffer) {
  const validation = validateTaxonomyImport(buffer)
  if (!validation.ok) {
    return { ok: false, errors: validation.errors }
  }
  const current = await getOrInitManagedSnapshot(adapter)
  const { snapshot, added, updated } = mergeImportByKey(
    JSON.parse(JSON.stringify(current)),
    validation.parsed,
  )
  const state = await saveManagedTaxonomy(adapter, snapshot)
  return { ok: true, state, added, updated }
}

const TAXONOMY_CONFIG_BASE = '/config/taxonomy'
const TAXONOMY_EXCEL_FILE = '打标配置.xlsx'

/**
 * 从 public/config/taxonomy/打标配置.xlsx 按 Key 合并导入到共享库（与上传 Excel 相同逻辑）。
 * @param {{ getMeta: (k: string) => Promise<unknown>; putMeta: (k: string, v: unknown) => Promise<void> }} adapter
 */
export async function importManagedTaxonomyFromConfigExcel(adapter) {
  const url = `${TAXONOMY_CONFIG_BASE}/${encodeURIComponent(TAXONOMY_EXCEL_FILE)}?t=${Date.now()}`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`未找到 ${TAXONOMY_EXCEL_FILE}（请确认 public/config/taxonomy/ 下存在该文件）`)
  }
  return importManagedTaxonomyIncremental(adapter, await res.arrayBuffer())
}
