import { MONITOR_USER_JOURNEY, MONITOR_PRODUCT_MATCH } from '../journeys/monitorJourney.js'

/**
 * 将托管标签库中的云监控产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateMonitorJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const monitor = snapshot.products.monitor
  if (!monitor) return changed

  const needsJourneys = !monitor.journeyConfigured || !(monitor.journeys?.length)
  if (needsJourneys) {
    monitor.journeys = structuredClone(MONITOR_USER_JOURNEY)
    monitor.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(monitor.match || []), ...MONITOR_PRODUCT_MATCH])]
  if (mergedMatch.length !== (monitor.match || []).length) {
    monitor.match = mergedMatch
    changed = true
  }

  if (!monitor.name?.trim()) {
    monitor.name = '云监控'
    changed = true
  }

  return changed
}
