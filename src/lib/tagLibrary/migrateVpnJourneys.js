import { VPN_USER_JOURNEY, VPN_PRODUCT_MATCH } from '../journeys/vpnJourney.js'

/**
 * 将托管标签库中的融合 VPN 产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateVpnJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const vpn = snapshot.products.vpn
  if (!vpn) return changed

  const needsJourneys = !vpn.journeyConfigured || !(vpn.journeys?.length)
  if (needsJourneys) {
    vpn.journeys = structuredClone(VPN_USER_JOURNEY)
    vpn.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(vpn.match || []), ...VPN_PRODUCT_MATCH])]
  if (mergedMatch.length !== (vpn.match || []).length) {
    vpn.match = mergedMatch
    changed = true
  }

  if (!vpn.name?.trim()) {
    vpn.name = '融合VPN'
    changed = true
  }

  return changed
}
