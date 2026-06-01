import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { isNegativeSentiment } from '../lib/sentiment.js'
import { buildWanTouByProducts } from '../lib/wanTouRatio.js'
import { filterRecordsForScope } from './recordScope.js'
import { buildPlanningRecommendations, limitPlanningRecommendations } from '../lib/planningRecommendations.js'
import { buildClusterRecommendationsFromPipeline } from '../lib/painPointClustering/buildClusterActionRecommendations.js'
import { formatClusteringExclusionNote } from '../lib/painPointClustering/clusteringSnapshot.js'
import { CLUSTERING_VERSION } from '../lib/painPointClustering/constants.js'
import { attachRecommendationPeriodCompare } from '../lib/planningRecommendationCompare.js'
import { getPlanningConfigVersions } from '../lib/planningConfigLoader.js'

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
 * @param {{ name: string; count: number }[][]} groups
 * @param {number} [limit]
 */
function mergeTopCounts(groups, limit = 5) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const arr of groups) {
    for (const row of arr) {
      if (!row?.name) continue
      map.set(row.name, (map.get(row.name) || 0) + (row.count || 0))
    }
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }))
}

/**
 * @param {Array<{ l1: string; count: number; children?: { l2: string; count: number }[] }>[]} trees
 */
function mergeJourneyTrees(trees) {
  /** @type {Map<string, { l1: string; count: number; children: Map<string, number> }>} */
  const map = new Map()

  for (const tree of trees) {
    if (!Array.isArray(tree)) continue
    for (const node of tree) {
      if (!map.has(node.l1)) {
        map.set(node.l1, { l1: node.l1, count: 0, children: new Map() })
      }
      const entry = map.get(node.l1)
      entry.count += node.count || 0
      for (const child of node.children || []) {
        entry.children.set(child.l2, (entry.children.get(child.l2) || 0) + (child.count || 0))
      }
    }
  }

  return [...map.values()]
    .map((n) => ({
      l1: n.l1,
      count: n.count,
      children: [...n.children.entries()]
        .map(([l2, count]) => ({ l2, count }))
        .sort((a, b) => b.count - a.count),
    }))
    .sort((a, b) => b.count - a.count)
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

  const problemTypeGroups = TICKET_SOURCES.map(
    (type) => sourceSnapshots[type]?.aggregates?.problemTypes || [],
  )
  const topProblemTypes = mergeTopCounts(problemTypeGroups, 5)

  const journeyTrees = TICKET_SOURCES.map(
    (type) => sourceSnapshots[type]?.aggregates?.journeyTree || [],
  )
  const mergedJourney = mergeJourneyTrees(journeyTrees)

  const trend = Array.isArray(crossSourceMetrics?.monthly_trend)
    ? crossSourceMetrics.monthly_trend
    : []
  let trendDeltaPct = null
  let trendDirection = 'flat'
  if (trend.length >= 2) {
    const last = trend[trend.length - 1]
    const prev = trend[trend.length - 2]
    const delta = (last?.count || 0) - (prev?.count || 0)
    if (prev?.count > 0) {
      trendDeltaPct = Math.round((delta / prev.count) * 100)
      trendDirection = delta > 0 ? 'up' : delta < 0 ? 'down' : 'flat'
    }
  }

  let maxNegativeSource = null
  let maxNegativePct = -1
  for (const type of TICKET_SOURCES) {
    const pct = sourceSnapshots[type]?.summary?.negativePct
    if (typeof pct === 'number' && pct > maxNegativePct) {
      maxNegativePct = pct
      maxNegativeSource = type
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
  const topWanTou = wanTouRows.find((r) => r.displayRatio != null)
  if (wanTouRows.length && wanTouRows.some((r) => r.missingOrderMonths?.length)) {
    dataCoverageNotes.push('部分产品月订单数未维护，万投比可能不完整（见设置 → 产品月订单数）')
  }

  const { recommendations: rawClusterRecommendations, pipelineResults } =
    buildClusterRecommendationsFromPipeline(ticketRecords, { settings })
  /** @type {OverviewRecommendation[]} */
  let rawRecommendations = rawClusterRecommendations
  /** @type {'pain_cluster_v2' | 'legacy_planning'} */
  let recommendationEngine = 'pain_cluster_v2'
  let legacyFallback = false

  const exclusionNote = formatClusteringExclusionNote(pipelineResults)
  if (exclusionNote) dataCoverageNotes.push(exclusionNote)

  if (!rawClusterRecommendations.length) {
    recommendationEngine = 'legacy_planning'
    legacyFallback = true
    rawRecommendations = buildPlanningRecommendations({
      ticketRecords,
      mergedJourney,
      topProblemTypes,
      sampleSize,
      topWanTou,
      maxNegativeSource,
      maxNegativePct,
      trendDeltaPct,
      trendDirection,
    })
    dataCoverageNotes.push(
      '本期未形成 V2 痛点聚类 Top 10（需有效「需求痛点挖掘」且二次聚类非空），已回退至规则引擎生成行动建议。',
    )
  }

  const limitedRecommendations = limitPlanningRecommendations(rawRecommendations)
  const { recommendations, removedFromPreviousCount } = attachRecommendationPeriodCompare(
    limitedRecommendations,
    previousRecommendations,
  )
  const configVersions = getPlanningConfigVersions()

  if (!recommendations.length) {
    const withRootCause = ticketRecords.filter((r) => r.rootCause?.trim()).length
    const withSuggestion = ticketRecords.filter((r) => r.optimizationSuggestion?.trim()).length
    if (withRootCause === 0 && withSuggestion === 0) {
      dataCoverageNotes.push(
        '本期工单缺少有效根因或优化建议字段，行动建议需依赖打标/人工复核后重新生成快照。',
      )
    } else {
      dataCoverageNotes.push(
        '本期数据未形成足够具体的行动建议（需根因聚类或工单优化建议/人工复核内容），建议补充人工复核举措后刷新。',
      )
    }
  }

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
      ruleVersion: recommendationEngine === 'pain_cluster_v2' ? `pain-cluster-${CLUSTERING_VERSION}` : 'planning-rec-v2',
      playbookVersion: configVersions.playbookVersion,
      signalWeightsVersion: configVersions.signalWeightsVersion,
      recommendationEngine,
      legacyFallback,
      previousPeriodId: previousPeriodId || undefined,
      generatedRecommendationCount: rawRecommendations.length,
      cappedCount: recommendations.length,
      removedFromPreviousCount,
    },
  }
}
