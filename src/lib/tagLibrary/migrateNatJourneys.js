import { NAT_USER_JOURNEY, NAT_PRODUCT_MATCH } from '../journeys/natJourney.js'

/**
 * 将托管标签库中的 NAT 网关产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateNatJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const nat = snapshot.products.nat
  if (!nat) return changed

  const needsJourneys = !nat.journeyConfigured || !(nat.journeys?.length)
  if (needsJourneys) {
    nat.journeys = structuredClone(NAT_USER_JOURNEY)
    nat.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(nat.match || []), ...NAT_PRODUCT_MATCH])]
  if (mergedMatch.length !== (nat.match || []).length) {
    nat.match = mergedMatch
    changed = true
  }

  if (!nat.name?.trim()) {
    nat.name = 'NAT网关'
    changed = true
  }

  return changed
}
