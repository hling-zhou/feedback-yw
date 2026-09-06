import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { isNegativeSentiment } from '../lib/sentiment.js'
import { buildWanTouByProducts } from '../lib/wanTouRatio.js'
import { filterRecordsForScope } from './recordScope.js'
import { limitPlanningRecommendations, appendSmallProductJourneyProblemFallbacks } from '../lib/planningRecommendations.js'
import {
  CLUSTER_FAMILY_STABLE_KEY_VERSION,
  CLUSTER_STABLE_KEY_VERSION,
  FALLBACK_STABLE_KEY_VERSION,
  isFallbackReferenceRecommendation,
  isFormalPainClusterRecommendation,
  isHighRiskSingletonRecommendation,
  isOverviewFusedClusterRecommendation,
} from '../lib/planningRecommendations.js'
import { buildClusterRecommendationsFromPipeline } from '../lib/painPointClustering/buildClusterActionRecommendations.js'
import { formatClusteringExclusionNote } from '../lib/painPointClustering/clusteringSnapshot.js'
import { CLUSTERING_VERSION } from '../lib/painPointClustering/constants.js'
import { buildOverviewFusedRecommendations } from '../lib/painPointClustering/overviewClusterFusion.js'
import { resolveClusterProfile } from '../lib/painPointClustering/resolveClusterProfile.js'
import { attachRecommendationPeriodCompare } from '../lib/planningRecommendationCompare.js'
import { applyCauseSpikeHighlight } from '../lib/planningRecommendationSections.js'
import { getPlanningConfigVersions } from '../lib/planningConfigLoader.js'
import { causeCoverageRate } from '../lib/painPointClustering/clusteringCause.js'
import { OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE } from './rehydrateOverviewRecommendations.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/snapshot.js').InsightSnapshot} InsightSnapshot */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../storage/orderVolumeStore.js').OrderVolumeRow} OrderVolumeRow */

const TICKET_SOURCES = /** @type {const} */ (['complaint_ticket', 'consultation_ticket'])

/**
 * @param {InsightPeriod | null | undefined} period
 */
function periodMonthKey(period) {
  if (period?.granularity === 'month' && period.anchorYear && period.anchorMonth) {
    return `${period.anchorYear}-${String(period.anchorMonth).padStart(2, '0')}`
  }
  return undefined
}

/**
 * @param {Object} params
 * @param {InsightPeriod | null | undefined} params.period
 * @param {FeedbackRecord[]} params.feedbacks
 * @param {Partial<Record<import('../domain/enums.js').DataSourceType, InsightSnapshot>>} params.sourceSnapshots
 * @param {Record<string, unknown>} params.crossSourceMetrics
 * @param {OrderVolumeRow[]} [params.orderVolumes]
 * @param {OverviewRecommendation[]} [params.previousRecommendations]
 * @param {string} [params.previousPeriodId]
 * @param {import('../lib/storage.js').AppSettings | null} [params.settings]
 * @returns {OverviewConclusions}
 */
export function buildOverviewConclusions({
  period,
  feedbacks,
  sourceSnapshots,
  crossSourceMetrics,
  orderVolumes = [],
  previousRecommendations = [],
  previousPeriodId,
  settings = null,
}) {
  const periodLabel = period?.label || '当前周期'
  const periodMonth = periodMonthKey(period)
  const totalRecords = Number(crossSourceMetrics?.totalRecords) || 0

  const ticketRecords = TICKET_SOURCES.flatMap((type) =>
    filterRecordsForScope(feedbacks, period, type),
  )
  const complaintRecords = filterRecordsForScope(feedbacks, period, 'complaint_ticket')
  const consultationRecords = filterRecordsForScope(feedbacks, period, 'consultation_ticket')
  const sampleSize = ticketRecords.length
  const complaintProfile = resolveClusterProfile({ sourceType: 'complaint_ticket' })
  const consultationProfile = resolveClusterProfile({ sourceType: 'consultation_ticket' })
  const overviewProfile = resolveClusterProfile({ scenario: 'overview' })

  /** @type {string[]} */
  const dataCoverageNotes = []
  const activeSources = DATA_SOURCE_TYPES.filter(
    (type) => (sourceSnapshots[type]?.summary?.recordCount ?? 0) > 0,
  )
  if (activeSources.length < DATA_SOURCE_TYPES.length) {
    const missing = DATA_SOURCE_TYPES.filter((t) => !activeSources.includes(t)).map(
      (t) => DATA_SOURCE_LABELS[t],
    )
    if (missing.length) {
      dataCoverageNotes.push(`以下来源本周期无数据：${missing.join('、')}`)
    }
  }

  const insufficientData = totalRecords < 3

  if (insufficientData) {
    return {
      generatedAt: new Date().toISOString(),
      source: 'rule',
      sampleSize,
      periodLabel,
      periodMonth,
      insightPeriodId: period?.id,
      insufficientData: true,
      executiveSummary: '',
      dataCoverageNotes,
      highlights: [],
      recommendations: [],
    }
  }

  const negativeTicketCount = ticketRecords.filter((r) => isNegativeSentiment(r.sentiment)).length
  const negativeTicketPct =
    sampleSize > 0 ? Math.round((negativeTicketCount / sampleSize) * 100) : 0

  const wanTouRows = buildWanTouByProducts({
    period,
    records: complaintRecords,
    orderVolumes,
    productList: sourceSnapshots.complaint_ticket?.aggregates?.products,
  })
  if (wanTouRows.length && wanTouRows.some((r) => r.missingOrderMonths?.length)) {
    dataCoverageNotes.push('部分产品月订单数未维护，万投比可能不完整（见设置 → 产品月订单数）')
  }

  const complaintResult = buildClusterRecommendationsFromPipeline(complaintRecords, {
    settings,
    profile: complaintProfile,
  })
  const consultationResult = buildClusterRecommendationsFromPipeline(consultationRecords, {
    settings,
    profile: consultationProfile,
  })
  const complaintRecommendations = appendSmallProductJourneyProblemFallbacks(
    complaintResult.recommendations,
    complaintRecords,
  )
  const consultationRecommendations = appendSmallProductJourneyProblemFallbacks(
    consultationResult.recommendations,
    consultationRecords,
  )
  const { fusedRecommendations, fallbackRecommendations } = buildOverviewFusedRecommendations(
    complaintRecommendations,
    consultationRecommendations,
  )
  const rawRecommendations = [...fusedRecommendations, ...fallbackRecommendations]
  const recommendationsWithFallbacks = rawRecommendations
  const pipelineResults = [...complaintResult.pipelineResults, ...consultationResult.pipelineResults]
  const smallProductFallbackCount =
    complaintRecommendations.length
    - complaintResult.recommendations.length
    + consultationRecommendations.length
    - consultationResult.recommendations.length
  const formalClusterCount = recommendationsWithFallbacks.filter((rec) =>
    isFormalPainClusterRecommendation(rec),
  ).length
  const fallbackReferenceCount = recommendationsWithFallbacks.filter((rec) =>
    isFallbackReferenceRecommendation(rec),
  ).length
  const singletonCount = recommendationsWithFallbacks.filter((rec) =>
    isHighRiskSingletonRecommendation(rec),
  ).length
  const overviewFusedCount = recommendationsWithFallbacks.filter((rec) =>
    isOverviewFusedClusterRecommendation(rec),
  ).length

  const exclusionNote = formatClusteringExclusionNote(pipelineResults)
  if (exclusionNote) dataCoverageNotes.push(exclusionNote)

  // v2.4：问题原因覆盖说明——缺少问题原因占比高时提示按问题类型回退
  const causeCoveragePct = ticketRecords.length
    ? Math.round(causeCoverageRate(ticketRecords) * 100)
    : 100
  const missingCausePct = 100 - causeCoveragePct
  if (missingCausePct >= 30) {
    dataCoverageNotes.push(
      `${missingCausePct}% 工单缺少问题原因，已按问题类型回退聚类（建议对存量工单批量重打标并勾选工单 LLM 以补全问题原因）。`,
    )
  }

  if (
    !recommendationsWithFallbacks.length &&
    !dataCoverageNotes.includes(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)
  ) {
    dataCoverageNotes.push(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)
  }

  const limitedRecommendations = limitPlanningRecommendations(recommendationsWithFallbacks, {
    ticketRecords,
  })
  const { recommendations: compared, removedFromPreviousCount } = attachRecommendationPeriodCompare(
    limitedRecommendations,
    previousRecommendations,
  )
  const recommendations = applyCauseSpikeHighlight(compared, ticketRecords)
  const configVersions = getPlanningConfigVersions()

  if (negativeTicketPct >= 30) {
    dataCoverageNotes.push(`工单类负面情绪占比约 ${negativeTicketPct}%（基于情绪标签统计）`)
  }

  return {
    generatedAt: new Date().toISOString(),
    source: 'rule',
    sampleSize,
    periodLabel,
    periodMonth,
    insightPeriodId: period?.id,
    insufficientData: false,
    executiveSummary: '',
    dataCoverageNotes,
    highlights: [],
    recommendations,
    recommendationsMeta: {
      ruleVersion: `pain-cluster-${CLUSTERING_VERSION}`,
      playbookVersion: configVersions.playbookVersion,
      signalWeightsVersion: configVersions.signalWeightsVersion,
      recommendationEngine: 'pain_cluster_v2_4',
      legacyFallback: false,
      previousPeriodId: previousPeriodId || undefined,
      generatedRecommendationCount: rawRecommendations.length,
      smallProductFallbackCount: smallProductFallbackCount || undefined,
      formalClusterCount,
      fallbackReferenceCount: fallbackReferenceCount || undefined,
      singletonCount: singletonCount || undefined,
      overviewFusedCount: overviewFusedCount || undefined,
      stableKeyVersion: `${CLUSTER_STABLE_KEY_VERSION}|${FALLBACK_STABLE_KEY_VERSION}|${CLUSTER_FAMILY_STABLE_KEY_VERSION}`,
      profileId: overviewProfile.profileId,
      scoreModelVersion: overviewProfile.scoreModelVersion,
      fingerprintVersion: overviewProfile.fingerprintVersion,
      cappedCount: recommendations.length,
      removedFromPreviousCount,
    },
  }
}
