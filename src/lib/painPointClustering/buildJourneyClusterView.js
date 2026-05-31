import { CLUSTERING_VERSION, DATA_SOURCE_SHORT_LABEL } from './constants.js'
import { getRecordDataSourceType, getRecordPainPoint } from './clusterLabel.js'
import { runPrimaryClustering } from './primaryCluster.js'

/** @typedef {import('./primaryCluster.js').PrimaryPainCluster} PrimaryPainCluster */
/** @typedef {import('./buildSourceClusterSnapshot.js').ProductPrimaryClusterSnapshot} ProductPrimaryClusterSnapshot */
/** @typedef {import('./buildSourceClusterSnapshot.js').SourcePainPointClusterSnapshot} SourcePainPointClusterSnapshot */

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
 * @property {import('../../domain/enums.js').DataSourceType} [dataSourceType]
 * @property {string} journeyL1
 * @property {string} [journeyL2]
 * @property {JourneyClusterGroupView[]} groups
 * @property {JourneyPainPointFrequency[]} frequencyPainPoints
 * @property {number} isolatedCount
 * @property {{ id: string; painPoint: string; ticketId?: string }[]} isolatedSamples
 * @property {string} sourceLabel
 * @property {'snapshot' | 'live' | 'frequency_fallback'} [clusterSource]
 */

/**
 * @typedef {Object} JourneyPainPointFrequency
 * @property {string} painPoint
 * @property {number} ticketCount
 * @property {string} problemType
 * @property {string[]} recordIds
 */

/**
 * @param {Object} params
 * @param {import('../types.js').FeedbackRecord[]} params.records
 * @param {string} params.product
 * @param {import('../../domain/enums.js').DataSourceType} [params.dataSourceType]
 * @param {string} params.journeyL1
 */
export function scopeRecordsForJourneyView({ records, product, dataSourceType, journeyL1 }) {
  return records.filter(
    (r) =>
      (r.product || '').trim() === product &&
      (!dataSourceType || getRecordDataSourceType(r) === dataSourceType) &&
      (r.journeyL1?.trim() || '未识别环节') === journeyL1,
  )
}

/**
 * @param {PrimaryPainCluster[]} groupsForL1
 * @param {import('../types.js').FeedbackRecord[]} scoped
 * @param {string} [journeyL2]
 * @returns {JourneyClusterGroupView[]}
 */
function mapPrimaryClustersToGroupViews(groupsForL1, scoped, journeyL2) {
  return groupsForL1.map((c) => {
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
}

/**
 * @param {import('../types.js').FeedbackRecord[]} isolatedRecords
 * @param {import('../../domain/enums.js').DataSourceType} [dataSourceType]
 * @param {string} journeyL1
 * @param {string} [journeyL2]
 */
function filterIsolatedForJourney(isolatedRecords, dataSourceType, journeyL1, journeyL2) {
  return isolatedRecords.filter((r) => {
    if (dataSourceType && getRecordDataSourceType(r) !== dataSourceType) return false
    if ((r.journeyL1?.trim() || '未识别环节') !== journeyL1) return false
    if (journeyL2 && r.journeyL2?.trim() !== journeyL2) return false
    return true
  })
}

/**
 * @param {Object} params
 * @param {PrimaryPainCluster[]} params.groupsForL1
 * @param {import('../types.js').FeedbackRecord[]} params.scoped
 * @param {import('../types.js').FeedbackRecord[]} params.isolatedRecords
 * @param {string} params.product
 * @param {import('../../domain/enums.js').DataSourceType} [params.dataSourceType]
 * @param {string} params.journeyL1
 * @param {string} [params.journeyL2]
 * @param {'snapshot' | 'live' | 'frequency_fallback'} [params.clusterSource]
 */
function assembleJourneyClusterView({
  groupsForL1,
  scoped,
  isolatedRecords,
  product,
  dataSourceType,
  journeyL1,
  journeyL2,
  clusterSource,
}) {
  const groups = mapPrimaryClustersToGroupViews(groupsForL1, scoped, journeyL2)
  const isolatedInScope = filterIsolatedForJourney(
    isolatedRecords,
    dataSourceType,
    journeyL1,
    journeyL2,
  )
  const visibleGroups = journeyL2 ? groups.filter((g) => g.ticketCount > 0) : groups

  return {
    product,
    dataSourceType,
    journeyL1,
    journeyL2,
    groups: visibleGroups,
    frequencyPainPoints: buildJourneyPainPointFrequency(scoped, { journeyL2 }),
    isolatedCount: isolatedInScope.length,
    isolatedSamples: isolatedInScope.slice(0, 20).map((r) => ({
      id: r.id,
      painPoint: getRecordPainPoint(r),
      ticketId: r.ticketId,
    })),
    sourceLabel: dataSourceType
      ? DATA_SOURCE_SHORT_LABEL[dataSourceType] || dataSourceType
      : '',
    clusterSource,
  }
}

/**
 * 数据来源 Tab：按 L1（及可选 L2 子集）展示一次聚类群组（live 计算，仅测试/快照构建使用）
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
  const scoped = scopeRecordsForJourneyView({ records, product, dataSourceType, journeyL1 })
  const { primaryClusters, isolatedRecords } = runPrimaryClustering(scoped, product)
  const groupsForL1 = primaryClusters.filter(
    (c) =>
      (!dataSourceType || c.dataSourceType === dataSourceType) && c.journeyL1 === journeyL1,
  )

  return assembleJourneyClusterView({
    groupsForL1,
    scoped,
    isolatedRecords,
    product,
    dataSourceType,
    journeyL1,
    journeyL2,
    clusterSource: 'live',
  })
}

/**
 * 从来源快照 `painPointClustering.products[product]` 切片展示旅程聚类（L0-1）
 *
 * @param {Object} params
 * @param {ProductPrimaryClusterSnapshot} params.productClustering
 * @param {import('../types.js').FeedbackRecord[]} params.records 当前 UI 筛选范围内的工单（用于 L2 子集与资源池交集）
 * @param {string} params.product
 * @param {import('../../domain/enums.js').DataSourceType} [params.dataSourceType]
 * @param {string} params.journeyL1
 * @param {string} [params.journeyL2]
 */
export function buildJourneyClusterViewFromSnapshot({
  productClustering,
  records,
  product,
  dataSourceType,
  journeyL1,
  journeyL2,
}) {
  const scoped = scopeRecordsForJourneyView({ records, product, dataSourceType, journeyL1 })
  const scopedIdSet = new Set(scoped.map((r) => r.id))
  const recordById = new Map(records.map((r) => [r.id, r]))

  /** @type {PrimaryPainCluster[]} */
  const groupsForL1 = (productClustering.primaryClusters || [])
    .filter(
      (c) =>
        (!dataSourceType || c.dataSourceType === dataSourceType) && c.journeyL1 === journeyL1,
    )
    .map((c) => {
      const recordIds = c.recordIds.filter((id) => scopedIdSet.has(id))
      return {
        ...c,
        recordIds,
        ticketCount: recordIds.length,
      }
    })
    .filter((c) => c.ticketCount > 0 || !journeyL2)

  const isolatedRecords = (productClustering.isolatedRecordIds || [])
    .map((id) => recordById.get(id))
    .filter(Boolean)
    .filter((r) => scopedIdSet.has(r.id))

  return assembleJourneyClusterView({
    groupsForL1,
    scoped,
    isolatedRecords,
    product,
    dataSourceType,
    journeyL1,
    journeyL2,
    clusterSource: 'snapshot',
  })
}

/**
 * 无快照时的轻量回退：仅高频痛点频次，不做层次聚类
 */
export function buildJourneyClusterViewFrequencyOnly({
  records,
  product,
  dataSourceType,
  journeyL1,
  journeyL2,
}) {
  const scoped = scopeRecordsForJourneyView({ records, product, dataSourceType, journeyL1 })
  return assembleJourneyClusterView({
    groupsForL1: [],
    scoped,
    isolatedRecords: [],
    product,
    dataSourceType,
    journeyL1,
    journeyL2,
    clusterSource: 'frequency_fallback',
  })
}

/**
 * 旅程 Tab 展示入口：优先读快照，否则频次回退（不在 UI 路径 live 聚类）
 *
 * @param {Object} params
 * @param {SourcePainPointClusterSnapshot | null | undefined} params.painPointClustering
 * @param {import('../types.js').FeedbackRecord[]} params.records
 * @param {string} params.product
 * @param {import('../../domain/enums.js').DataSourceType} [params.dataSourceType]
 * @param {string} params.journeyL1
 * @param {string} [params.journeyL2]
 */
export function resolveJourneyClusterViewForDisplay({
  painPointClustering,
  records,
  product,
  dataSourceType,
  journeyL1,
  journeyL2,
}) {
  const productSnapshot =
    painPointClustering?.clusteringVersion === CLUSTERING_VERSION
      ? painPointClustering.products?.[product]
      : undefined

  if (productSnapshot) {
    return buildJourneyClusterViewFromSnapshot({
      productClustering: productSnapshot,
      records,
      product,
      dataSourceType,
      journeyL1,
      journeyL2,
    })
  }

  return buildJourneyClusterViewFrequencyOnly({
    records,
    product,
    dataSourceType,
    journeyL1,
    journeyL2,
  })
}

/**
 * 一级/二级环节内按痛点原文频次排序（≥1 条即展示，作聚类群组补充或回退）
 *
 * @param {import('../types.js').FeedbackRecord[]} scopedRecords 已限定 product + journeyL1
 * @param {{ journeyL2?: string; limit?: number }} [options]
 * @returns {JourneyPainPointFrequency[]}
 */
export function buildJourneyPainPointFrequency(scopedRecords, options = {}) {
  const { journeyL2, limit = 10 } = options
  /** @type {Map<string, JourneyPainPointFrequency>} */
  const map = new Map()

  for (const r of scopedRecords) {
    if (journeyL2 && r.journeyL2?.trim() !== journeyL2) continue
    const pain = getRecordPainPoint(r)
    if (!pain) continue
    const key = pain.replace(/\s+/g, '')
    if (!map.has(key)) {
      map.set(key, {
        painPoint: pain,
        ticketCount: 0,
        problemType: r.problemType?.trim() || '其他',
        recordIds: [],
      })
    }
    const entry = map.get(key)
    entry.ticketCount += 1
    entry.recordIds.push(r.id)
    if (r.problemType?.trim()) {
      entry.problemType = r.problemType.trim()
    }
  }

  return [...map.values()]
    .sort((a, b) => b.ticketCount - a.ticketCount || b.painPoint.length - a.painPoint.length)
    .slice(0, limit)
}
