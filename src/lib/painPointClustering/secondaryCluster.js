import { SECONDARY_CLUSTER_THRESHOLD } from './constants.js'
import { clusterByJaccard } from './jaccardHierarchical.js'
import { buildFinalClusterLabel } from './clusterLabel.js'

/**
 * @typedef {import('./primaryCluster.js').PrimaryPainCluster} PrimaryPainCluster
 */

/**
 * @typedef {Object} FinalPainCluster
 * @property {string} id
 * @property {string} product
 * @property {string} label
 * @property {string} representativePainPoint
 * @property {PrimaryPainCluster[]} primaryGroups
 * @property {string[]} recordIds
 * @property {number} ticketCount
 */

/**
 * @param {PrimaryPainCluster[]} retainedPrimary
 * @param {string} product
 */
export function runSecondaryClustering(retainedPrimary, product) {
  if (!retainedPrimary.length) {
    return /** @type {FinalPainCluster[]} */ ([])
  }

  const { clusters } = clusterByJaccard(
    retainedPrimary,
    (c) => c.representativePainPoint || c.label,
    SECONDARY_CLUSTER_THRESHOLD,
    1,
  )

  /** @type {FinalPainCluster[]} */
  const finalClusters = []

  clusters.forEach((primaryGroup, index) => {
    const recordIds = [...new Set(primaryGroup.flatMap((p) => p.recordIds))]
    const representativePainPoint =
      primaryGroup
        .slice()
        .sort((a, b) => b.ticketCount - a.ticketCount)[0]?.representativePainPoint || ''

    finalClusters.push({
      id: `final-${product}-${index}`,
      product,
      label: buildFinalClusterLabel(representativePainPoint, []),
      representativePainPoint,
      primaryGroups: primaryGroup,
      recordIds,
      ticketCount: recordIds.length,
    })
  })

  return finalClusters
}
