import { CLUSTERING_VERSION } from './constants.js'
import { filterLowValuePrimaryClusters } from './filterLowValue.js'
import { runPrimaryClustering } from './primaryCluster.js'
import { scoreAndRankFinalClusters } from './priorityScore.js'
import { runSecondaryClustering } from './secondaryCluster.js'

/**
 * @typedef {import('./primaryCluster.js').PrimaryPainCluster} PrimaryPainCluster
 * @typedef {import('./secondaryCluster.js').FinalPainCluster} FinalPainCluster
 * @typedef {import('./priorityScore.js').ScoredFinalCluster} ScoredFinalCluster
 */

/**
 * @typedef {Object} ProductClusteringResult
 * @property {string} product
 * @property {string} clusteringVersion
 * @property {number} productTotalTickets
 * @property {PrimaryPainCluster[]} primaryClusters
 * @property {import('../types.js').FeedbackRecord[]} isolatedRecords
 * @property {PrimaryPainCluster[]} excludedPrimaryClusters
 * @property {number} excludedPrimaryClusterCount
 * @property {number} excludedPrimaryTicketCount
 * @property {FinalPainCluster[]} finalClusters
 * @property {ScoredFinalCluster[]} topFinalClusters
 */

/**
 * 单产品完整聚类 pipeline（V2）
 *
 * @param {import('../types.js').FeedbackRecord[]} records 周期内该产品全部工单（可含多来源）
 * @param {string} product
 */
export function runProductClusteringPipeline(records, product) {
  const productRecords = records.filter((r) => (r.product || '').trim() === product)
  const productTotalTickets = productRecords.length

  const { primaryClusters, isolatedRecords } = runPrimaryClustering(productRecords, product)

  const {
    retained,
    excluded,
    excludedClusterCount,
    excludedTicketCount,
  } = filterLowValuePrimaryClusters(primaryClusters)

  const finalClusters = runSecondaryClustering(retained, product)
  const topFinalClusters = scoreAndRankFinalClusters(
    finalClusters,
    productRecords,
    productTotalTickets,
  )

  return {
    product,
    clusteringVersion: CLUSTERING_VERSION,
    productTotalTickets,
    primaryClusters,
    isolatedRecords,
    excludedPrimaryClusters: excluded,
    excludedPrimaryClusterCount: excludedClusterCount,
    excludedPrimaryTicketCount: excludedTicketCount,
    finalClusters,
    topFinalClusters,
  }
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 * @returns {string[]}
 */
export function listClusteringProducts(records) {
  const set = new Set()
  for (const r of records) {
    const p = r.product?.trim()
    if (p) set.add(p)
  }
  return [...set].sort()
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {string} [product] 若省略则对每个产品分别跑 pipeline
 */
export function runMultiProductClusteringPipeline(records, product) {
  if (product) {
    return [runProductClusteringPipeline(records, product)]
  }
  return listClusteringProducts(records).map((p) =>
    runProductClusteringPipeline(records, p),
  )
}
