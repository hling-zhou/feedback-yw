import { VPC_USER_JOURNEY, VPC_PRODUCT_MATCH } from '../journeys/vpcJourney.js'

/** 实单校准版本；递增后 migrate 会覆盖托管库中的 VPC 旅程 */
export const VPC_JOURNEY_CALIBRATION_VERSION = 2

/**
 * 为托管标签库注入 VPC 内置用户旅程（新建或覆盖未配置的空模板）。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateVpcJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  let vpc = snapshot.products.vpc
  if (!vpc) {
    snapshot.products.vpc = {
      key: 'vpc',
      name: '虚拟私有云',
      match: [...VPC_PRODUCT_MATCH],
      journeys: structuredClone(VPC_USER_JOURNEY),
      journeyConfigured: true,
      catalogProvisioned: false,
      journeyCalibrationVersion: VPC_JOURNEY_CALIBRATION_VERSION,
    }
    return true
  }

  const needsJourneys =
    !(vpc.journeys?.length) ||
    (vpc.journeyCalibrationVersion || 0) < VPC_JOURNEY_CALIBRATION_VERSION
  if (needsJourneys) {
    vpc.journeys = structuredClone(VPC_USER_JOURNEY)
    vpc.journeyConfigured = true
    vpc.catalogProvisioned = false
    vpc.journeyCalibrationVersion = VPC_JOURNEY_CALIBRATION_VERSION
    changed = true
  }

  const mergedMatch = [...new Set([...(vpc.match || []), ...VPC_PRODUCT_MATCH])]
  if (mergedMatch.length !== (vpc.match || []).length) {
    vpc.match = mergedMatch
    changed = true
  }

  if (!vpc.name?.trim()) {
    vpc.name = '虚拟私有云'
    changed = true
  }

  return changed
}
