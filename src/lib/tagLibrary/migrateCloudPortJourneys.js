import { CLOUD_PORT_USER_JOURNEY, CLOUD_PORT_PRODUCT_MATCH } from '../journeys/cloudPortJourney.js'

/**
 * 将托管标签库中的云端口产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateCloudPortJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const cp = snapshot.products.cloud_port
  if (!cp) return changed

  const needsJourneys = !cp.journeyConfigured || !(cp.journeys?.length)
  if (needsJourneys) {
    cp.journeys = structuredClone(CLOUD_PORT_USER_JOURNEY)
    cp.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(cp.match || []), ...CLOUD_PORT_PRODUCT_MATCH])]
  if (mergedMatch.length !== (cp.match || []).length) {
    cp.match = mergedMatch
    changed = true
  }

  if (!cp.name?.trim()) {
    cp.name = '云端口'
    changed = true
  }

  return changed
}
