/**
 * @typedef {import('./secondaryCluster.js').FinalPainCluster} FinalPainCluster
 * @typedef {import('./priorityScore.js').ScoredFinalCluster} ScoredFinalCluster
 */

/**
 * 稳定簇指纹：排序后的 recordIds（M2-4 golden 对比用）
 * @param {{ recordIds?: string[] }} cluster
 */
export function clusterRecordIdsFingerprint(cluster) {
  return [...(cluster.recordIds || [])].sort().join('|')
}

/**
 * @param {ScoredFinalCluster | FinalPainCluster} cluster
 */
export function clusterTop10Fingerprint(cluster) {
  const ids = clusterRecordIdsFingerprint(cluster)
  if (ids) return ids
  return (cluster.representativePainPoint || cluster.label || '').trim()
}

/**
 * @param {Array<ScoredFinalCluster | FinalPainCluster>} topClusters
 */
export function topClusterFingerprints(topClusters) {
  return topClusters.map((cluster) => clusterTop10Fingerprint(cluster))
}

/**
 * @param {import('../runProductClusteringPipeline.js').ProductClusteringResult} result
 */
export function productTop10Fingerprints(result) {
  return topClusterFingerprints(result.topFinalClusters)
}
