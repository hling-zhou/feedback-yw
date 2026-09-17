import { CLOUDDNS_USER_JOURNEY, CLOUDDNS_PRODUCT_MATCH } from '../journeys/clouddnsJourney.js'

/**
 * 将托管标签库中的云解析产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateClouddnsJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const dns = snapshot.products.CloudDNS
  if (!dns) return changed

  const needsJourneys = !dns.journeyConfigured || !(dns.journeys?.length)
  if (needsJourneys) {
    dns.journeys = structuredClone(CLOUDDNS_USER_JOURNEY)
    dns.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(dns.match || []), ...CLOUDDNS_PRODUCT_MATCH])]
  if (mergedMatch.length !== (dns.match || []).length) {
    dns.match = mergedMatch
    changed = true
  }

  if (!dns.name?.trim()) {
    dns.name = '云解析'
    changed = true
  }

  return changed
}
