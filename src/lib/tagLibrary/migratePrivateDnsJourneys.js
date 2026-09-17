import { PRIVATE_DNS_USER_JOURNEY, PRIVATE_DNS_PRODUCT_MATCH } from '../journeys/privateDnsJourney.js'

/**
 * 将托管标签库中的内网DNS产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migratePrivateDnsJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const pdns = snapshot.products.privateDNS
  if (!pdns) return changed

  const needsJourneys = !pdns.journeyConfigured || !(pdns.journeys?.length)
  if (needsJourneys) {
    pdns.journeys = structuredClone(PRIVATE_DNS_USER_JOURNEY)
    pdns.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(pdns.match || []), ...PRIVATE_DNS_PRODUCT_MATCH])]
  if (mergedMatch.length !== (pdns.match || []).length) {
    pdns.match = mergedMatch
    changed = true
  }

  if (!pdns.name?.trim()) {
    pdns.name = '内网DNS'
    changed = true
  }

  return changed
}
