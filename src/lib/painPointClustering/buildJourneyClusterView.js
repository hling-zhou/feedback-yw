import { DATA_SOURCE_SHORT_LABEL } from './constants.js'
import { getRecordDataSourceType, getRecordPainPoint } from './clusterLabel.js'
import { runPrimaryClustering } from './primaryCluster.js'

/**
 * @typedef {Object} JourneyClusterGroupView
 * @property {string} id
 * @property {string} label
 * @property {string} representativePainPoint
 * @property {string} problemType
 * @property {number} ticketCount
 * @property {string[]} recordIds
 * @property {number} [l2TicketCount] L2 子集工单数
 */

/**
 * @typedef {Object} JourneyClusterView
 * @property {string} product
 * @property {import('../../domain/enums.js').DataSourceType} dataSourceType
 * @property {string} journeyL1
 * @property {string} [journeyL2]
 * @property {JourneyClusterGroupView[]} groups
 * @property {number} isolatedCount
 * @property {{ id: string; painPoint: string; ticketId?: string }[]} isolatedSamples
 */

/**
 * 数据来源 Tab：按 L1（及可选 L2 子集）展示一次聚类群组
 *
 * @param {Object} params
 * @param {import('../types.js').FeedbackRecord[]} params.records 已筛：周期+产品+来源
 * @param {string} params.product
 * @param {import('../../domain/enums.js').DataSourceType} params.dataSourceType
 * @param {string} params.journeyL1
 * @param {string} [params.journeyL2]
 */
export function buildJourneyClusterView({
  records,
  product,
  dataSourceType,
  journeyL1,
  journeyL2,
}) {
  const scoped = records.filter(
    (r) =>
      (r.product || '').trim() === product &&
      (!dataSourceType || getRecordDataSourceType(r) === dataSourceType) &&
      (r.journeyL1?.trim() || '未识别环节') === journeyL1,
  )

  const { primaryClusters, isolatedRecords } = runPrimaryClustering(scoped, product)

  const groupsForL1 = primaryClusters.filter(
    (c) =>
      (!dataSourceType || c.dataSourceType === dataSourceType) && c.journeyL1 === journeyL1,
  )

  /** @type {JourneyClusterGroupView[]} */
  const groups = groupsForL1.map((c) => {
    let recordIds = c.recordIds
    let ticketCount = c.ticketCount
    if (journeyL2) {
      const l2Records = scoped.filter(
        (r) => c.recordIds.includes(r.id) && r.journeyL2?.trim() === journeyL2,
      )
      recordIds = l2Records.map((r) => r.id)
      ticketCount = recordIds.length
    }
    return {
      id: c.id,
      label: c.label,
      representativePainPoint: c.representativePainPoint,
      problemType: c.problemType,
      ticketCount,
      recordIds,
      l2TicketCount: journeyL2 ? ticketCount : undefined,
    }
  })

  const isolatedInScope = isolatedRecords.filter((r) => {
    if (dataSourceType && getRecordDataSourceType(r) !== dataSourceType) return false
    if ((r.journeyL1?.trim() || '未识别环节') !== journeyL1) return false
    if (journeyL2 && r.journeyL2?.trim() !== journeyL2) return false
    return true
  })

  return {
    product,
    dataSourceType,
    journeyL1,
    journeyL2,
    groups: journeyL2 ? groups.filter((g) => g.ticketCount > 0) : groups,
    isolatedCount: isolatedInScope.length,
    isolatedSamples: isolatedInScope.slice(0, 20).map((r) => ({
      id: r.id,
      painPoint: getRecordPainPoint(r),
      ticketId: r.ticketId,
    })),
    sourceLabel: dataSourceType
      ? DATA_SOURCE_SHORT_LABEL[dataSourceType] || dataSourceType
      : '',
  }
}
