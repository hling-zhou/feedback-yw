import {
  VPC_ENDPOINT_USER_JOURNEY,
  VPC_ENDPOINT_PRODUCT_MATCH,
} from '../journeys/vpcEndpointJourney.js'

/** 旅程一二级内容待后续任务填充；递增版本号使迁移覆盖空模板 */
export const VPC_ENDPOINT_JOURNEY_CALIBRATION_VERSION = 1

/**
 * 为托管标签库注入 VPC终端节点 内置用户旅程（新建或覆盖未配置的空模板）。
 *
 * 此迁移解决两个历史问题：
 * 1. vpc_endpoint 之前没有独立模板，工单被贪婪匹配到 vpc 模板
 * 2. 线上快照中 vpc.name 被错误改写为「VPC终端节点」（已由 syncCatalogProductsToTaxonomy 修复）
 *
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateVpcEndpointJourneysInSnapshot(snapshot) {
  if (!snapshot?.products) return false
  let changed = false

  let ep = snapshot.products.vpc_endpoint
  if (!ep) {
    snapshot.products.vpc_endpoint = {
      key: 'vpc_endpoint',
      name: 'VPC终端节点',
      match: [...VPC_ENDPOINT_PRODUCT_MATCH],
      journeys: structuredClone(VPC_ENDPOINT_USER_JOURNEY),
      journeyConfigured: true,
      catalogProvisioned: false,
      journeyCalibrationVersion: VPC_ENDPOINT_JOURNEY_CALIBRATION_VERSION,
    }
    return true
  }

  const needsJourneys =
    !(ep.journeys?.length) ||
    (ep.journeyCalibrationVersion || 0) < VPC_ENDPOINT_JOURNEY_CALIBRATION_VERSION
  if (needsJourneys) {
    ep.journeys = structuredClone(VPC_ENDPOINT_USER_JOURNEY)
    ep.journeyConfigured = true
    ep.catalogProvisioned = false
    ep.journeyCalibrationVersion = VPC_ENDPOINT_JOURNEY_CALIBRATION_VERSION
    changed = true
  }

  const mergedMatch = [
    ...new Set([...(ep.match || []), ...VPC_ENDPOINT_PRODUCT_MATCH]),
  ]
  if (mergedMatch.length !== (ep.match || []).length) {
    ep.match = mergedMatch
    changed = true
  }

  if (!ep.name?.trim()) {
    ep.name = 'VPC终端节点'
    changed = true
  }

  return changed
}
