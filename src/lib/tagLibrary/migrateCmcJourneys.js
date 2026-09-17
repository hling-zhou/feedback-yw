import { CMC_USER_JOURNEY, CMC_PRODUCT_MATCH } from '../journeys/cmcJourney.js'

/**
 * 将托管标签库中的云迁移中心产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateCmcJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const cmc = snapshot.products.cmc
  if (!cmc) return changed

  const needsJourneys = !cmc.journeyConfigured || !(cmc.journeys?.length)
  if (needsJourneys) {
    cmc.journeys = structuredClone(CMC_USER_JOURNEY)
    cmc.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(cmc.match || []), ...CMC_PRODUCT_MATCH])]
  if (mergedMatch.length !== (cmc.match || []).length) {
    cmc.match = mergedMatch
    changed = true
  }

  if (!cmc.name?.trim()) {
    cmc.name = '云迁移中心'
    changed = true
  }

  return changed
}
