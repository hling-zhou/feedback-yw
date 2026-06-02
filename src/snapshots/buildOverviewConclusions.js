import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { isNegativeSentiment } from '../lib/sentiment.js'
import { buildWanTouByProducts } from '../lib/wanTouRatio.js'
import { filterRecordsForScope } from './recordScope.js'
import { limitPlanningRecommendations } from '../lib/planningRecommendations.js'
import { buildClusterRecommendationsFromPipeline } from '../lib/painPointClustering/buildClusterActionRecommendations.js'
import { formatClusteringExclusionNote } from '../lib/painPointClustering/clusteringSnapshot.js'
import { CLUSTERING_VERSION } from '../lib/painPointClustering/constants.js'
import { attachRecommendationPeriodCompare } from '../lib/planningRecommendationCompare.js'
import { getPlanningConfigVersions } from '../lib/planningConfigLoader.js'
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
  const sampleSize = ticketRecords.length

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

  const { recommendations: rawRecommendations, pipelineResults } =
    buildClusterRecommendationsFromPipeline(ticketRecords, { settings })

  const exclusionNote = formatClusteringExclusionNote(pipelineResults)
  if (exclusionNote) dataCoverageNotes.push(exclusionNote)

  if (!rawRecommendations.length && !dataCoverageNotes.includes(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)) {
    dataCoverageNotes.push(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)
  }

  const limitedRecommendations = limitPlanningRecommendations(rawRecommendations)
  const { recommendations, removedFromPreviousCount } = attachRecommendationPeriodCompare(
    limitedRecommendations,
    previousRecommendations,
  )
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
      recommendationEngine: 'pain_cluster_v2',
      legacyFallback: false,
      previousPeriodId: previousPeriodId || undefined,
      generatedRecommendationCount: rawRecommendations.length,
      cappedCount: recommendations.length,
      removedFromPreviousCount,
    },
  }
}
