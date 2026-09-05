import { EIP_USER_JOURNEY, EIP_PRODUCT_MATCH } from '../journeys/eipJourney.js'

/** 实单校准版本；递增后 migrate 会覆盖托管库中的 EIP 旅程 */
export const EIP_JOURNEY_CALIBRATION_VERSION = 1

/**
 * 将托管标签库中的 EIP 产品覆盖为代码内置旅程。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateEipJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  let eip = snapshot.products.eip
  if (!eip) {
    snapshot.products.eip = {
      key: 'eip',
      name: '弹性公网IP',
      match: [...EIP_PRODUCT_MATCH],
      journeys: structuredClone(EIP_USER_JOURNEY),
      journeyConfigured: true,
      catalogProvisioned: false,
      journeyCalibrationVersion: EIP_JOURNEY_CALIBRATION_VERSION,
    }
    return true
  }

  const needsJourneys =
    !eip.journeyConfigured ||
    !(eip.journeys?.length) ||
    (eip.journeyCalibrationVersion || 0) < EIP_JOURNEY_CALIBRATION_VERSION
  if (needsJourneys) {
    eip.journeys = structuredClone(EIP_USER_JOURNEY)
    eip.journeyConfigured = true
    eip.catalogProvisioned = false
    eip.journeyCalibrationVersion = EIP_JOURNEY_CALIBRATION_VERSION
    changed = true
  }

  const mergedMatch = [...new Set([...(eip.match || []), ...EIP_PRODUCT_MATCH])]
  if (mergedMatch.length !== (eip.match || []).length) {
    eip.match = mergedMatch
    changed = true
  }

  if (!eip.name?.trim()) {
    eip.name = '弹性公网IP'
    changed = true
  }

  return changed
}
