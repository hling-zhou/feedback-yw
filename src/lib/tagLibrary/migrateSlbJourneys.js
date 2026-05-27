import { SLB_USER_JOURNEY, SLB_PRODUCT_MATCH } from '../journeys/slbJourney.js'

const LEGACY_SLB_KEYS = new Set(['SLB'])

/**
 * 将托管标签库中的 SLB 旧 key 迁移为 slb，并注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateSlbJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  for (const legacyKey of [...LEGACY_SLB_KEYS]) {
    const legacy = snapshot.products[legacyKey]
    if (!legacy) continue

    if (!snapshot.products.slb) {
      snapshot.products.slb = {
        ...structuredClone(legacy),
        key: 'slb',
        name: legacy.name?.trim() || '弹性负载均衡',
        match: [...new Set([...(legacy.match || []), ...SLB_PRODUCT_MATCH])],
        journeys: structuredClone(SLB_USER_JOURNEY),
        journeyConfigured: true,
        catalogProvisioned: false,
      }
      changed = true
    }

    delete snapshot.products[legacyKey]
    changed = true
  }

  const slb = snapshot.products.slb
  if (!slb) return changed

  const needsJourneys = !slb.journeyConfigured || !(slb.journeys?.length)
  if (needsJourneys) {
    slb.journeys = structuredClone(SLB_USER_JOURNEY)
    slb.journeyConfigured = true
    slb.catalogProvisioned = false
    changed = true
  }

  const mergedMatch = [...new Set([...(slb.match || []), ...SLB_PRODUCT_MATCH])]
  if (mergedMatch.length !== (slb.match || []).length) {
    slb.match = mergedMatch
    changed = true
  }

  if (!slb.name?.trim()) {
    slb.name = '弹性负载均衡'
    changed = true
  }

  return changed
}
