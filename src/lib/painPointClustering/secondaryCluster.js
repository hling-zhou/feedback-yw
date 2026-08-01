import { SECONDARY_CLUSTER_THRESHOLD } from './constants.js'
import { computeClusterSimilarity } from './clusterSimilarity.js'
import { clusterByJaccard } from './jaccardHierarchical.js'
import { buildNormalizedPainText } from './normalizeSemanticTokens.js'
import { resolveClusterProfile } from './resolveClusterProfile.js'
import { resolveClusterThresholds } from './thresholdStrategy.js'
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
 * @param {import('./primaryCluster.js').ClusteringPipelineOptions} [pipelineOptions]
 */
export function runSecondaryClustering(retainedPrimary, product, pipelineOptions = {}) {
  const profile = pipelineOptions.profile || resolveClusterProfile()
  if (!retainedPrimary.length) {
    return /** @type {FinalPainCluster[]} */ ([])
  }

  const enrichedPrimary = retainedPrimary.map((cluster) => ({
    ...cluster,
    normalizedPainText: buildNormalizedPainText(cluster.representativePainPoint || cluster.label),
  }))
  const thresholds = resolveClusterThresholds({
    profile,
    records: enrichedPrimary,
    product,
    stage: 'secondary',
  })
  const { clusters } = clusterByJaccard(
    enrichedPrimary,
    (c) => c.representativePainPoint || c.label,
    thresholds.threshold || SECONDARY_CLUSTER_THRESHOLD,
    1,
    {
      ...pipelineOptions,
      minSharedTokens: pipelineOptions.minSharedTokens ?? thresholds.minSharedTokens,
      buildNormalizedText: (text, item) => item.normalizedPainText || buildNormalizedPainText(text),
      getTokenSet: (text, item, normalizedPainText) =>
        normalizedPainText.semanticTokens || buildNormalizedPainText(text).semanticTokens,
      getPairSimilarity: (left, right) =>
        computeClusterSimilarity(left.normalizedPainText, right.normalizedPainText, {
          left: {
            product,
            journeyL1: left.item?.journeyL1,
            dataSourceType: left.item?.dataSourceType,
            problemType: left.item?.problemType,
          },
          right: {
            product,
            journeyL1: right.item?.journeyL1,
            dataSourceType: right.item?.dataSourceType,
            problemType: right.item?.problemType,
          },
          profile,
        }),
    },
  )

  /** @type {FinalPainCluster[]} */
  const finalClusters = []

  clusters.forEach((primaryGroup, index) => {
    const recordIds = [...new Set(primaryGroup.flatMap((p) => p.recordIds))].sort()
    const representativePainPoint =
      primaryGroup
        .slice()
        .sort((a, b) => b.ticketCount - a.ticketCount)[0]?.representativePainPoint || ''

    finalClusters.push({
      id: `final-${product}-${index}`,
      product,
      label: buildFinalClusterLabel(representativePainPoint, []),
      representativePainPoint,
      primaryGroups: primaryGroup.map(({ normalizedPainText: _normalizedPainText, ...group }) => group),
      recordIds,
      ticketCount: recordIds.length,
    })
  })

  return finalClusters
}
