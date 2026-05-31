import { PRIMARY_CLUSTER_THRESHOLD, PRIMARY_MIN_CLUSTER_SIZE, PRIMARY_CLUSTER_MAX_ITEMS } from './constants.js'
import { clusterByJaccard } from './jaccardHierarchical.js'
import { normalizePainPointKey } from './normalizePainPoint.js'
import {
  buildPrimaryClusterLabel,
  getRecordDataSourceType,
  getRecordPainPoint,
  majorityProblemType,
  pickRepresentativePainPoint,
} from './clusterLabel.js'

/**
 * @typedef {Object} PrimaryPainCluster
 * @property {string} id
 * @property {string} product
 * @property {import('../../domain/enums.js').DataSourceType} dataSourceType
 * @property {string} journeyL1
 * @property {string} label
 * @property {string} representativePainPoint
 * @property {string} problemType
 * @property {string[]} recordIds
 * @property {number} ticketCount
 */

/**
 * @param {string} product
 * @param {import('../../domain/enums.js').DataSourceType} dataSourceType
 * @param {string} journeyL1
 */
export function primaryGroupKey(product, dataSourceType, journeyL1) {
  return `${product}\0${dataSourceType}\0${journeyL1}`
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {string} product
 */
export function runPrimaryClustering(records, product) {
  /** @type {PrimaryPainCluster[]} */
  const primaryClusters = []
  /** @type {import('../types.js').FeedbackRecord[]} */
  const isolatedRecords = []

  /** @type {Map<string, import('../types.js').FeedbackRecord[]>} */
  const groups = new Map()

  for (const r of records) {
    if ((r.product || '').trim() !== product) continue
    const pain = getRecordPainPoint(r)
    if (!pain) continue
    const ds = getRecordDataSourceType(r)
    const l1 = r.journeyL1?.trim() || '未识别环节'
    const key = primaryGroupKey(product, ds, l1)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(r)
  }

  let clusterSeq = 0
  for (const [key, groupRecords] of groups) {
    const [prod, dataSourceType, journeyL1] = key.split('\0')
    const uniqueKeys = new Set(
      groupRecords.map((r) => normalizePainPointKey(getRecordPainPoint(r))),
    )
    if (import.meta.env?.DEV && uniqueKeys.size > PRIMARY_CLUSTER_MAX_ITEMS) {
      console.info(
        `[pain-cluster] 大组 ${prod}/${dataSourceType}/${journeyL1}: ${groupRecords.length} 条, ${uniqueKeys.size} unique`,
      )
    }

    const { clusters, isolated } = clusterByJaccard(
      groupRecords,
      getRecordPainPoint,
      PRIMARY_CLUSTER_THRESHOLD,
      PRIMARY_MIN_CLUSTER_SIZE,
    )
    isolatedRecords.push(...isolated)

    for (const clusterRecords of clusters) {
      const representativePainPoint = pickRepresentativePainPoint(clusterRecords)
      const problemType = majorityProblemType(clusterRecords)
      const id = `primary-${product}-${dataSourceType}-${journeyL1}-${clusterSeq}`
      clusterSeq += 1
      primaryClusters.push({
        id,
        product: prod,
        dataSourceType: /** @type {import('../../domain/enums.js').DataSourceType} */ (
          dataSourceType
        ),
        journeyL1,
        label: buildPrimaryClusterLabel({
          product: prod,
          dataSourceType: /** @type {import('../../domain/enums.js').DataSourceType} */ (
            dataSourceType
          ),
          journeyL1,
          representativePainPoint,
        }),
        representativePainPoint,
        problemType,
        recordIds: clusterRecords.map((r) => r.id),
        ticketCount: clusterRecords.length,
      })
    }
  }

  return { primaryClusters, isolatedRecords }
}

/**
 * @param {PrimaryPainCluster[]} primaryClusters
 * @param {import('../types.js').FeedbackRecord[]} allRecords
 */
export function primaryClustersToRecordMap(primaryClusters, allRecords) {
  const byId = new Map(allRecords.map((r) => [r.id, r]))
  return primaryClusters.map((c) => ({
    cluster: c,
    records: c.recordIds.map((id) => byId.get(id)).filter(Boolean),
  }))
}
