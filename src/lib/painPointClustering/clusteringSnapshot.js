import { CLUSTERING_VERSION } from './constants.js'

/** @typedef {import('./runProductClusteringPipeline.js').ProductClusteringResult} ProductClusteringResult */
/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */

/**
 * @param {ProductClusteringResult[]} pipelineResults
 */
export function summarizeClusteringExclusions(pipelineResults) {
  return {
    excludedPrimaryClusterCount: pipelineResults.reduce(
      (sum, r) => sum + r.excludedPrimaryClusterCount,
      0,
    ),
    excludedPrimaryTicketCount: pipelineResults.reduce(
      (sum, r) => sum + r.excludedPrimaryTicketCount,
      0,
    ),
    productCount: pipelineResults.length,
    topClusterCount: pipelineResults.reduce((sum, r) => sum + r.topFinalClusters.length, 0),
  }
}

/**
 * @param {ProductClusteringResult[]} pipelineResults
 */
export function formatClusteringExclusionNote(pipelineResults) {
  const { excludedPrimaryClusterCount, excludedPrimaryTicketCount } =
    summarizeClusteringExclusions(pipelineResults)
  if (!excludedPrimaryClusterCount) return null
  return `已剔除 ${excludedPrimaryClusterCount} 个低价值配额/其他类一次群组，涉及工单 ${excludedPrimaryTicketCount} 件。`
}

/**
 * @param {import('../domain/snapshot.js').InsightSnapshot['aggregates']} aggregates
 */
export function isSourceSnapshotClusteringStale(aggregates) {
  const clustering = aggregates?.painPointClustering
  if (!clustering) return true
  return clustering.clusteringVersion !== CLUSTERING_VERSION
}

/**
 * @param {import('../domain/snapshot.js').InsightSnapshot['aggregates']} aggregates
 * @param {FeedbackRecord[]} records
 */
export function resolveSourcePainPointClustering(aggregates, records) {
  const stored = aggregates?.painPointClustering
  if (stored?.clusteringVersion === CLUSTERING_VERSION && stored.products) {
    return { ...stored, source: 'snapshot' }
  }
  return {
    clusteringVersion: CLUSTERING_VERSION,
    products: {},
    source: 'missing',
  }
}
