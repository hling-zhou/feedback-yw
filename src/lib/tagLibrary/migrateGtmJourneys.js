import { GTM_USER_JOURNEY, GTM_PRODUCT_MATCH } from '../journeys/gtmJourney.js'

/**
 * 将托管标签库中的全局流量管理产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateGtmJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const gtm = snapshot.products.gtm
  if (!gtm) return changed

  const needsJourneys = !gtm.journeyConfigured || !(gtm.journeys?.length)
  if (needsJourneys) {
    gtm.journeys = structuredClone(GTM_USER_JOURNEY)
    gtm.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(gtm.match || []), ...GTM_PRODUCT_MATCH])]
  if (mergedMatch.length !== (gtm.match || []).length) {
    gtm.match = mergedMatch
    changed = true
  }

  if (!gtm.name?.trim()) {
    gtm.name = '全局流量管理'
    changed = true
  }

  return changed
}
