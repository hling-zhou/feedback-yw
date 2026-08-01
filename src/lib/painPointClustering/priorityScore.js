import { FINAL_CLUSTER_TOP_N } from './constants.js'
import { getP90EmotionIntensity } from './emotionIntensity.js'
import { resolveClusterProfile } from './resolveClusterProfile.js'
import { getMaxSeverity, getP90Severity } from './severity.js'
import { getUrgencyLevel, isNegativeSentiment } from '../sentiment.js'
import { normalizeCustomerTier } from '../../domain/customerTier.js'

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

function highValueCustomerCount(records) {
  return (records || []).filter((record) => {
    const tier = normalizeCustomerTier(record?.customerTier)
    return tier === '金牌' || tier === '银牌'
  }).length
}

function unresolvedCount(records) {
  return (records || []).filter(
    (record) => record?.followUpSatisfaction?.problemResolved === 'unresolved',
  ).length
}

function urgentCount(records) {
  return (records || []).filter((record) => getUrgencyLevel(record) === 'high').length
}

function repeatedConsultationRate(records) {
  if (!records?.length) return 0
  const groups = new Map()
  for (const record of records) {
    const key = [
      record?.problemType,
      record?.journeyL1,
      record?.painPoint || record?.problemSummary || '',
    ].join('\0')
    groups.set(key, (groups.get(key) || 0) + 1)
  }
  const repeated = [...groups.values()].filter((count) => count > 1).reduce((sum, count) => sum + count, 0)
  return repeated / records.length
}

function selfServicePotential(records) {
  if (!records?.length) return 0
  const matched = records.filter((record) =>
    /文档|说明|指引|教程|帮助|申请|操作|配置|开通|自助/.test(
      `${record?.requestScene || ''} ${record?.problemType || ''} ${record?.painPoint || ''} ${record?.problemSummary || ''}`,
    ))
  return matched.length / records.length
}

function breadthContinuousScore(sharePct) {
  return Math.max(1, Math.min(5, 1 + sharePct / 4))
}

function confidenceDiscount(ticketCount) {
  if (ticketCount >= 8) return 1
  if (ticketCount >= 5) return 0.95
  if (ticketCount >= 3) return 0.88
  return 0.76
}

function clampScore(value) {
  return Math.max(1, Math.min(5, value))
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
  profileInput = null,
) {
  const profile = profileInput || resolveClusterProfile()
  const byId = new Map(allRecords.map((r) => [r.id, r]))

  /** @type {ScoredFinalCluster[]} */
  const scored = finalClusters.map((cluster) => {
    const records = cluster.recordIds.map((id) => byId.get(id)).filter(Boolean)
    const legacyScores = computeClusterScores(records, productTotalTickets)
    const sharePct = legacyScores.sharePct
    const ticketCount = legacyScores.ticketCount
    const breadthScore = breadthContinuousScore(sharePct)
    const p90Severity = getP90Severity(records)
    const p90Emotion = getP90EmotionIntensity(records)
    const maxSeverity = getMaxSeverity(records)
    const urgentRate = ticketCount > 0 ? urgentCount(records) / ticketCount : 0
    const unresolvedRate = ticketCount > 0 ? unresolvedCount(records) / ticketCount : 0
    const highValueRate = ticketCount > 0 ? highValueCustomerCount(records) / ticketCount : 0
    const negativeRate = ticketCount > 0 ? records.filter((record) => isNegativeSentiment(record?.sentiment)).length / ticketCount : 0
    const repeatRate = repeatedConsultationRate(records)
    const selfServiceRate = selfServicePotential(records)

    let harmScore = legacyScores.harmScore
    let priorityScore = legacyScores.priorityScore
    /** @type {Record<string, number>} */
    let scoreBreakdown = {
      breadthScore,
      severityP90: p90Severity,
      emotionP90: p90Emotion,
      urgentRate,
      unresolvedRate,
      highValueRate,
    }

    if (profile.profileId === 'complaint') {
      harmScore = clampScore(
        p90Severity * 0.32
        + p90Emotion * 0.2
        + urgentRate * 5 * 0.16
        + unresolvedRate * 5 * 0.16
        + highValueRate * 5 * 0.16,
      )
      priorityScore = clampScore(
        (breadthScore * 0.4 + harmScore * 0.6) * confidenceDiscount(ticketCount),
      )
    } else if (profile.profileId === 'consultation') {
      harmScore = clampScore(
        breadthScore * 0.15
        + repeatRate * 5 * 0.25
        + selfServiceRate * 5 * 0.25
        + negativeRate * 5 * 0.1
        + highValueRate * 5 * 0.1
        + p90Emotion * 0.15,
      )
      priorityScore = clampScore(
        (breadthScore * 0.45 + harmScore * 0.55) * confidenceDiscount(ticketCount),
      )
      scoreBreakdown = {
        ...scoreBreakdown,
        repeatRate,
        selfServiceRate,
        negativeRate,
      }
    }

    return {
      ...cluster,
      ...legacyScores,
      breadthScore,
      maxSeverity,
      p90Severity,
      p90Emotion,
      harmScore,
      priorityScore,
      scoreBreakdown,
      urgentRate,
      unresolvedRate,
      highValueRate,
      negativeRate,
      repeatRate,
      selfServiceRate,
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
