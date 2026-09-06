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
 * @property {string} representativeCause 问题原因代表句（v2.4）
 * @property {string} causeKey 问题原因归一化键（v2.4）
 * @property {PrimaryPainCluster[]} primaryGroups
 * @property {string[]} recordIds
 * @property {number} ticketCount
 */

/**
 * 二次聚类（v2.4）：只按「问题原因」合并，不再按痛点相似度跨 L1/来源合并。
 *
 * - 同因（相同 causeKey）的一次簇合并为一类（允许跨旅程 L1 / 来源）
 * - 无因（causeKey 空）的一次簇**不跨 L1 合并**，各自保持独立
 * - 异因（causeKey 不同）禁止合并
 *
 * @param {PrimaryPainCluster[]} retainedPrimary
 * @param {string} product
 * @param {import('./primaryCluster.js').ClusteringPipelineOptions} [pipelineOptions]
 */
export function runSecondaryClustering(retainedPrimary, product, pipelineOptions = {}) {
  const profile = pipelineOptions.profile || resolveClusterProfile()
  if (!retainedPrimary.length) {
    return /** @type {FinalPainCluster[]} */ ([])
  }

  // v2.4：按问题原因键合并；无因的一次簇各自独立，不再跨 L1 痛点合并
  /** @type {Map<string, PrimaryPainCluster[]>} */
  const byCause = new Map()
  /** @type {PrimaryPainCluster[]} */
  const noCause = []
  for (const cluster of retainedPrimary) {
    const key = cluster.causeKey || ''
    if (!key) {
      noCause.push(cluster)
    } else if (byCause.has(key)) {
      byCause.get(key).push(cluster)
    } else {
      byCause.set(key, [cluster])
    }
  }

  /** @type {PrimaryPainCluster[][]} */
  const mergedGroups = []
  for (const group of byCause.values()) {
    mergedGroups.push(group)
  }
  // 无因簇各自独立（不跨 L1 合并）
  for (const cluster of noCause) {
    mergedGroups.push([cluster])
  }

  /** @type {FinalPainCluster[]} */
  const finalClusters = []

  mergedGroups.forEach((primaryGroup, index) => {
    const recordIds = [...new Set(primaryGroup.flatMap((p) => p.recordIds))].sort()
    const representativePainPoint =
      primaryGroup
        .slice()
        .sort((a, b) => b.ticketCount - a.ticketCount)[0]?.representativePainPoint || ''
    const representativeCause =
      primaryGroup
        .slice()
        .sort((a, b) => b.ticketCount - a.ticketCount)[0]?.representativeCause || ''
    const causeKey = primaryGroup[0]?.causeKey || ''

    finalClusters.push({
      id: `final-${product}-${index}`,
      product,
      label: buildFinalClusterLabel(representativePainPoint, []),
      representativePainPoint,
      representativeCause,
      causeKey,
      primaryGroups: primaryGroup.map((group) => group),
      recordIds,
      ticketCount: recordIds.length,
    })
  })

  return finalClusters
}

// 保留旧 Jaccard 二次聚类函数供回归/小产品回退（v2.4 默认不调用）
/**
 * @param {PrimaryPainCluster[]} retainedPrimary
 * @param {string} product
 * @param {import('./primaryCluster.js').ClusteringPipelineOptions} [pipelineOptions]
 * @deprecated v2.4 起改用按问题原因合并；保留供回归测试
 */
export function runSecondaryClusteringByPain(retainedPrimary, product, pipelineOptions = {}) {
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
      representativeCause: '',
      causeKey: '',
      primaryGroups: primaryGroup.map(({ normalizedPainText: _normalizedPainText, ...group }) => group),
      recordIds,
      ticketCount: recordIds.length,
    })
  })

  return finalClusters
}
