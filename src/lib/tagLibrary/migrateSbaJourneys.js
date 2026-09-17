import { SBA_USER_JOURNEY, SBA_PRODUCT_MATCH } from '../journeys/sbaJourney.js'

/**
 * 将托管标签库中的场景化加速产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateSbaJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const sba = snapshot.products.sba
  if (!sba) return changed

  const needsJourneys = !sba.journeyConfigured || !(sba.journeys?.length)
  if (needsJourneys) {
    sba.journeys = structuredClone(SBA_USER_JOURNEY)
    sba.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(sba.match || []), ...SBA_PRODUCT_MATCH])]
  if (mergedMatch.length !== (sba.match || []).length) {
    sba.match = mergedMatch
    changed = true
  }

  if (!sba.name?.trim()) {
    sba.name = '场景化加速'
    changed = true
  }

  return changed
}
