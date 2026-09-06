import { DATA_SOURCE_LABELS } from '../domain/enums.js'
import {
  limitPlanningRecommendations,
  appendSmallProductJourneyProblemFallbacks,
  CLUSTER_FAMILY_STABLE_KEY_VERSION,
  CLUSTER_STABLE_KEY_VERSION,
  FALLBACK_STABLE_KEY_VERSION,
  isFallbackReferenceRecommendation,
  isFormalPainClusterRecommendation,
  isHighRiskSingletonRecommendation,
} from '../lib/planningRecommendations.js'
import { buildClusterRecommendationsFromPipeline } from '../lib/painPointClustering/buildClusterActionRecommendations.js'
import { formatClusteringExclusionNote } from '../lib/painPointClustering/clusteringSnapshot.js'
import { CLUSTERING_VERSION } from '../lib/painPointClustering/constants.js'
import { resolveClusterProfile } from '../lib/painPointClustering/resolveClusterProfile.js'
import { attachRecommendationPeriodCompare } from '../lib/planningRecommendationCompare.js'
import { applyCauseSpikeHighlight } from '../lib/planningRecommendationSections.js'
import { getPlanningConfigVersions } from '../lib/planningConfigLoader.js'
import { causeCoverageRate } from '../lib/painPointClustering/clusteringCause.js'
import { OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE } from './rehydrateOverviewRecommendations.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/insightPeriod.js').InsightPeriod} InsightPeriod */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @param {InsightPeriod | null | undefined} period
 */
function periodMonthKey(period) {
  if (period?.granularity === 'month' && period.anchorYear && period.anchorMonth) {
    return `${period.anchorYear}-${String(period.anchorMonth).padStart(2, '0')}`
  }
  if (period?.granularity === 'custom' && period.customToMonth) {
    return period.customToMonth
  }
  return undefined
}

/**
 * 按单一数据来源（投诉/咨询）生成「典型问题」结论，结构兼容 OverviewConclusions。
 *
 * @param {Object} params
 * @param {InsightPeriod | null | undefined} params.period
 * @param {DataSourceType} params.dataSourceType
 * @param {FeedbackRecord[]} params.records 已限定为本源 + 周期的工单
 * @param {OverviewRecommendation[]} [params.previousRecommendations]
 * @param {string} [params.previousPeriodId]
 * @param {import('../lib/storage.js').AppSettings | null} [params.settings]
 * @returns {OverviewConclusions}
 */
export function buildSourcePlanningConclusions({
  period,
  dataSourceType,
  records,
  previousRecommendations = [],
  previousPeriodId,
  settings = null,
}) {
  const profile = resolveClusterProfile({ sourceType: dataSourceType })
  const periodLabel = period?.label || '当前周期'
  const periodMonth = periodMonthKey(period)
  const sampleSize = records.length
  const sourceLabel = DATA_SOURCE_LABELS[dataSourceType] || dataSourceType

  /** @type {string[]} */
  const dataCoverageNotes = []

  if (sampleSize < 3) {
    return {
      generatedAt: new Date().toISOString(),
      source: 'rule',
      sampleSize,
      periodLabel,
      periodMonth,
      insightPeriodId: period?.id,
      insufficientData: true,
      executiveSummary: '',
      dataCoverageNotes: [
        `${sourceLabel}本周期样本不足（${sampleSize} 条），暂不生成典型问题。`,
      ],
      highlights: [],
      recommendations: [],
    }
  }

  const { recommendations: rawRecommendations, pipelineResults } =
    buildClusterRecommendationsFromPipeline(records, { settings, profile })

  const recommendationsWithFallbacks = appendSmallProductJourneyProblemFallbacks(
    rawRecommendations,
    records,
  )
  const smallProductFallbackCount =
    recommendationsWithFallbacks.length - rawRecommendations.length
  const formalClusterCount = recommendationsWithFallbacks.filter((rec) =>
    isFormalPainClusterRecommendation(rec),
  ).length
  const fallbackReferenceCount = recommendationsWithFallbacks.filter((rec) =>
    isFallbackReferenceRecommendation(rec),
  ).length
  const singletonCount = recommendationsWithFallbacks.filter((rec) =>
    isHighRiskSingletonRecommendation(rec),
  ).length

  const exclusionNote = formatClusteringExclusionNote(pipelineResults)
  if (exclusionNote) dataCoverageNotes.push(exclusionNote)

  // v2.4：问题原因覆盖说明——缺少问题原因占比高时提示按问题类型回退
  const causeCoveragePct = records.length
    ? Math.round(causeCoverageRate(records) * 100)
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
    ticketRecords: records,
  })
  const { recommendations: compared, removedFromPreviousCount } = attachRecommendationPeriodCompare(
    limitedRecommendations,
    previousRecommendations,
  )
  const recommendations = applyCauseSpikeHighlight(compared, records)
  const configVersions = getPlanningConfigVersions()

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
      stableKeyVersion: `${CLUSTER_STABLE_KEY_VERSION}|${FALLBACK_STABLE_KEY_VERSION}|${CLUSTER_FAMILY_STABLE_KEY_VERSION}`,
      profileId: profile.profileId,
      scoreModelVersion: profile.scoreModelVersion,
      fingerprintVersion: profile.fingerprintVersion,
      cappedCount: recommendations.length,
      removedFromPreviousCount,
      dataSourceType,
    },
  }
}
