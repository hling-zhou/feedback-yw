import { CC_USER_JOURNEY, CC_PRODUCT_MATCH } from '../journeys/ccJourney.js'

/** 实单校准版本；递增后 migrate 会覆盖托管库中的云组网旅程 */
export const CC_JOURNEY_CALIBRATION_VERSION = 1

/**
 * 将托管标签库中的云组网产品注入内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateCcJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  const cc = snapshot.products.cc
  if (!cc) return changed

  const needsJourneys =
    !cc.journeyConfigured ||
    !(cc.journeys?.length) ||
    (cc.journeyCalibrationVersion || 0) < CC_JOURNEY_CALIBRATION_VERSION
  if (needsJourneys) {
    cc.journeys = structuredClone(CC_USER_JOURNEY)
    cc.journeyConfigured = true
    cc.journeyCalibrationVersion = CC_JOURNEY_CALIBRATION_VERSION
    changed = true
  }

  const mergedMatch = [...new Set([...(cc.match || []), ...CC_PRODUCT_MATCH])]
  if (mergedMatch.length !== (cc.match || []).length) {
    cc.match = mergedMatch
    changed = true
  }

  if (!cc.name?.trim()) {
    cc.name = '云组网'
    changed = true
  }

  return changed
}
