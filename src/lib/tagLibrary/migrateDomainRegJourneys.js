import { DOMAIN_REG_USER_JOURNEY, DOMAIN_REG_PRODUCT_MATCH } from '../journeys/domainRegJourney.js'

/**
 * 将托管标签库中的域名注册产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateDomainRegJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const dr = snapshot.products.domain_reg
  if (!dr) return changed

  const needsJourneys = !dr.journeyConfigured || !(dr.journeys?.length)
  if (needsJourneys) {
    dr.journeys = structuredClone(DOMAIN_REG_USER_JOURNEY)
    dr.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(dr.match || []), ...DOMAIN_REG_PRODUCT_MATCH])]
  if (mergedMatch.length !== (dr.match || []).length) {
    dr.match = mergedMatch
    changed = true
  }

  if (!dr.name?.trim()) {
    dr.name = '域名注册'
    changed = true
  }

  return changed
}
