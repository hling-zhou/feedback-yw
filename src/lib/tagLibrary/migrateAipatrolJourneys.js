import { AIPATROL_USER_JOURNEY, AIPATROL_PRODUCT_MATCH } from '../journeys/aipatrolJourney.js'

/**
 * 将托管标签库中的AI巡考服务产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateAipatrolJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const ai = snapshot.products.aipatrol
  if (!ai) return changed

  const needsJourneys = !ai.journeyConfigured || !(ai.journeys?.length)
  if (needsJourneys) {
    ai.journeys = structuredClone(AIPATROL_USER_JOURNEY)
    ai.journeyConfigured = true
    changed = true
  }

  const mergedMatch = [...new Set([...(ai.match || []), ...AIPATROL_PRODUCT_MATCH])]
  if (mergedMatch.length !== (ai.match || []).length) {
    ai.match = mergedMatch
    changed = true
  }

  if (!ai.name?.trim()) {
    ai.name = 'AI巡考服务'
    changed = true
  }

  return changed
}
