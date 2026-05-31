import { FINAL_CLUSTER_TOP_N } from './constants.js'
import { getP90EmotionIntensity } from './emotionIntensity.js'
import { getMaxSeverity } from './severity.js'

/**
 * @typedef {import('./secondaryCluster.js').FinalPainCluster} FinalPainCluster
 */

/**
 * @param {number} sharePct 0~100
 */
export function breadthScoreFromShare(sharePct) {
  if (sharePct < 1) return 1
  if (sharePct < 3) return 2
  if (sharePct < 8) return 3
  if (sharePct < 15) return 4
  return 5
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 * @param {number} productTotalTickets
 */
export function computeClusterScores(records, productTotalTickets) {
  const ticketCount = records.length
  const sharePct =
    productTotalTickets > 0 ? (ticketCount / productTotalTickets) * 100 : 0
  const breadthScore = breadthScoreFromShare(sharePct)
  const maxSeverity = getMaxSeverity(records)
  const p90Emotion = getP90EmotionIntensity(records)
  const harmScore = maxSeverity * 0.6 + p90Emotion * 0.4
  const priorityScore = breadthScore * 0.5 + harmScore * 0.5

  return {
    ticketCount,
    sharePct,
    breadthScore,
    maxSeverity,
    p90Emotion,
    harmScore,
    priorityScore,
  }
}

/**
 * @typedef {FinalPainCluster & ReturnType<typeof computeClusterScores> & { rank: number; totalFinal: number }} ScoredFinalCluster
 */

/**
 * @param {FinalPainCluster[]} finalClusters
 * @param {import('../types.js').FeedbackRecord[]} allRecords
 * @param {number} productTotalTickets
 * @param {number} [topN]
 */
export function scoreAndRankFinalClusters(
  finalClusters,
  allRecords,
  productTotalTickets,
  topN = FINAL_CLUSTER_TOP_N,
) {
  const byId = new Map(allRecords.map((r) => [r.id, r]))

  /** @type {ScoredFinalCluster[]} */
  const scored = finalClusters.map((cluster) => {
    const records = cluster.recordIds.map((id) => byId.get(id)).filter(Boolean)
    const scores = computeClusterScores(records, productTotalTickets)
    return {
      ...cluster,
      ...scores,
      rank: 0,
      totalFinal: 0,
    }
  })

  scored.sort((a, b) => {
    if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore
    return b.harmScore - a.harmScore
  })

  const top = scored.slice(0, topN).map((c, i) => ({
    ...c,
    rank: i + 1,
    totalFinal: Math.min(topN, scored.length),
  }))

  return top
}
