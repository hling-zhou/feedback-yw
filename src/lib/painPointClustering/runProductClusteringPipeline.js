import { CLUSTERING_VERSION } from './constants.js'
import { filterLowValuePrimaryClusters } from './filterLowValue.js'
import { identifyHighRiskSingletons } from './highRiskSingletons.js'
import { runPrimaryClustering } from './primaryCluster.js'
import { scoreAndRankFinalClusters } from './priorityScore.js'
import { resolveClusterProfile } from './resolveClusterProfile.js'
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
 * @property {{ record: import('../types.js').FeedbackRecord; riskScore: number }[]} highRiskSingletons
 * @property {FinalPainCluster[]} finalClusters
 * @property {ScoredFinalCluster[]} topFinalClusters
 */

/**
 * @typedef {import('./primaryCluster.js').ClusteringPipelineOptions} ClusteringPipelineOptions
 */

/**
 * 单产品完整聚类 pipeline（V2）
 *
 * @param {import('../types.js').FeedbackRecord[]} records 周期内该产品全部工单（可含多来源）
 * @param {string} product
 * @param {ClusteringPipelineOptions} [pipelineOptions]
 */
export function runProductClusteringPipeline(records, product, pipelineOptions = {}) {
  const profile = pipelineOptions.profile || resolveClusterProfile()
  const productRecords = records.filter((r) => (r.product || '').trim() === product)
  const productTotalTickets = productRecords.length

  const { primaryClusters, isolatedRecords } = runPrimaryClustering(
    productRecords,
    product,
    {
      ...pipelineOptions,
      profile,
    },
  )

  const {
    retained,
    excluded,
    excludedClusterCount,
    excludedTicketCount,
  } = filterLowValuePrimaryClusters(primaryClusters, profile)

  const finalClusters = runSecondaryClustering(retained, product, {
    ...pipelineOptions,
    profile,
  })
  const topFinalClusters = scoreAndRankFinalClusters(
    finalClusters,
    productRecords,
    productTotalTickets,
    profile.topN,
    profile,
  )
  const highRiskSingletons = identifyHighRiskSingletons(isolatedRecords, profile)

  return {
    product,
    clusteringVersion: CLUSTERING_VERSION,
    profileId: profile.profileId,
    productTotalTickets,
    primaryClusters,
    isolatedRecords,
    excludedPrimaryClusters: excluded,
    excludedPrimaryClusterCount: excludedClusterCount,
    excludedPrimaryTicketCount: excludedTicketCount,
    highRiskSingletons,
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
export function runMultiProductClusteringPipeline(records, product, pipelineOptions = {}) {
  if (product) {
    return [runProductClusteringPipeline(records, product, pipelineOptions)]
  }
  return listClusteringProducts(records).map((p) =>
    runProductClusteringPipeline(records, p, pipelineOptions),
  )
}
