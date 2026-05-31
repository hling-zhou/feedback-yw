import { DATA_SOURCE_TYPES, DATA_SOURCE_LABELS } from '../domain/enums.js'
import { isNegativeSentiment } from '../lib/sentiment.js'
import { buildWanTouByProducts, formatWanTouRatio } from '../lib/wanTouRatio.js'
import { filterRecordsForScope } from './recordScope.js'
import { buildPlanningRecommendations, limitPlanningRecommendations } from '../lib/planningRecommendations.js'
import { buildClusterRecommendationsFromPipeline } from '../lib/painPointClustering/buildClusterActionRecommendations.js'
import { formatClusteringExclusionNote } from '../lib/painPointClustering/clusteringSnapshot.js'
import { CLUSTERING_VERSION } from '../lib/painPointClustering/constants.js'
import { attachRecommendationPeriodCompare } from '../lib/planningRecommendationCompare.js'
import { getPlanningConfigVersions } from '../lib/planningConfigLoader.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusionHighlight} OverviewConclusionHighlight */
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
 * @param {FeedbackRecord[]} records
 * @param {number} [limit]
 */
function topEvidenceExcerpts(records, limit = 2) {
  /** @type {Map<string, number>} */
  const map = new Map()
  for (const r of records) {
    const text = (r.rootCause || r.problemSummary || '').trim()
    if (!text || text.length < 8) continue
    const key = text.slice(0, 80)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }))
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
      executiveSummary: `本周期（${periodLabel}）有效反馈仅 ${totalRecords} 条，样本不足，暂不生成自动结论。请导入更多数据或切换周期后重新生成洞察快照。`,
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
  const topL1 = mergedJourney[0]
  const topL2 = topL1?.children?.[0]

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

  const topProduct =
    sourceSnapshots.complaint_ticket?.summary?.topProduct ||
    sourceSnapshots.consultation_ticket?.summary?.topProduct ||
    '—'

  const executiveParts = [
    `本周期（${periodLabel}）共收录 ${totalRecords} 条反馈，其中工单类 ${sampleSize} 条。`,
  ]
  if (topProblemTypes[0]) {
    executiveParts.push(
      `最突出问题类型为「${topProblemTypes[0].name}」（${topProblemTypes[0].count} 条${sampleSize > 0 ? `，占工单类约 ${Math.round((topProblemTypes[0].count / sampleSize) * 100)}%` : ''}）。`,
    )
  }
  if (topL2) {
    executiveParts.push(
      `用户旅程集中在「${topL1.l1} → ${topL2.l2}」（${topL2.count} 条）。`,
    )
  }
  if (trendDirection === 'up' && trendDeltaPct != null) {
    executiveParts.push(`跨源工单月度趋势最近一月环比上升约 ${trendDeltaPct}%。`)
  } else if (trendDirection === 'down' && trendDeltaPct != null) {
    executiveParts.push(`跨源工单月度趋势最近一月环比下降约 ${Math.abs(trendDeltaPct)}%。`)
  }
  if (maxNegativeSource && maxNegativePct >= 30) {
    executiveParts.push(
      `${DATA_SOURCE_LABELS[maxNegativeSource]}负面占比 ${maxNegativePct}%，需优先关注体验与根因闭环。`,
    )
  }

  /** @type {OverviewConclusionHighlight[]} */
  const highlights = []

  highlights.push({
    id: 'cross-source-volume',
    type: 'cross_source',
    title: '跨源反馈体量',
    body: `本周期 ${activeSources.length} 类来源有数据；工单类合计 ${sampleSize} 条${totalRecords > 0 ? `，占总量 ${Math.round((sampleSize / totalRecords) * 100)}%` : ''}。`,
    metrics: [
      { label: '反馈总量', value: String(totalRecords) },
      { label: '工单类', value: String(sampleSize) },
      ...activeSources.map((t) => ({
        label: DATA_SOURCE_LABELS[t],
        value: String(sourceSnapshots[t]?.summary?.recordCount ?? 0),
      })),
    ],
    sources: activeSources,
  })

  if (topProduct && topProduct !== '—') {
    highlights.push({
      id: 'product-top',
      type: 'product',
      title: '产品投诉集中',
      body: `投诉工单 Top 产品为「${topProduct}」。${topWanTou ? `万投比最高为「${topWanTou.productName}」（${formatWanTouRatio(topWanTou.displayRatio)}）。` : '可在设置中维护订单数以计算万投比。'}`,
      metrics: [
        { label: 'Top 产品', value: topProduct },
        ...(topWanTou
          ? [
              { label: '最高万投比产品', value: topWanTou.productName },
              { label: '万投比', value: formatWanTouRatio(topWanTou.displayRatio) },
            ]
          : []),
      ],
      sources: ['complaint_ticket'],
      drillTab: 'complaint_ticket',
    })
  }

  if (topProblemTypes.length) {
    const top3 = topProblemTypes.slice(0, 3)
    highlights.push({
      id: 'problem-type-top',
      type: 'problem_type',
      title: '突出问题类型',
      body: top3.map((p) => `「${p.name}」${p.count} 条`).join('；') + '。',
      metrics: top3.map((p) => ({ label: p.name, value: `${p.count} 条` })),
      sources: TICKET_SOURCES.filter((t) => (sourceSnapshots[t]?.summary?.recordCount ?? 0) > 0),
      drillTab: 'complaint_ticket',
    })
  }

  if (topL2) {
    const evidence = topEvidenceExcerpts(
      ticketRecords.filter(
        (r) => r.journeyL1 === topL1.l1 && r.journeyL2 === topL2.l2,
      ),
    )
    highlights.push({
      id: 'journey-hotspot',
      type: 'journey',
      title: '旅程热点环节',
      body:
        `「${topL1.l1} → ${topL2.l2}」为工单最集中环节（${topL2.count} 条）。` +
        (evidence[0] ? ` 典型表述：${evidence[0].text.slice(0, 60)}…` : ''),
      metrics: [
        { label: '一级旅程', value: topL1.l1 },
        { label: '二级旅程', value: topL2.l2 },
        { label: '工单数', value: String(topL2.count) },
      ],
      sources: TICKET_SOURCES,
      drillTab: 'complaint_ticket',
    })
  }

  /** @type {OverviewConclusionHighlight[]} */
  const risks = []
  if (maxNegativePct >= 25 && maxNegativeSource) {
    risks.push({
      id: 'risk-negative',
      type: 'risk',
      title: '负面占比偏高',
      body: `${DATA_SOURCE_LABELS[maxNegativeSource]}负面情绪占比 ${maxNegativePct}%，建议结合根因与旅程热点制定改进项。`,
      metrics: [
        { label: '来源', value: DATA_SOURCE_LABELS[maxNegativeSource] },
        { label: '负面占比', value: `${maxNegativePct}%` },
      ],
      sources: [maxNegativeSource],
      drillTab: maxNegativeSource,
    })
  }
  if (trendDirection === 'up' && trendDeltaPct != null && trendDeltaPct >= 15) {
    risks.push({
      id: 'risk-trend-spike',
      type: 'risk',
      title: '工单量环比上升',
      body: `跨源月度趋势最近一月较上月上升约 ${trendDeltaPct}%，需排查是否由特定产品/环节驱动。`,
      metrics: [{ label: '环比变化', value: `+${trendDeltaPct}%` }],
      sources: TICKET_SOURCES,
    })
  }
  if (topWanTou && topWanTou.displayRatio != null && topWanTou.displayRatio >= 50) {
    risks.push({
      id: 'risk-wan-tou',
      type: 'risk',
      title: '万投比异常',
      body: `「${topWanTou.productName}」万投比 ${formatWanTouRatio(topWanTou.displayRatio)}，建议结合 Top 问题类型与旅程环节做专项治理。`,
      metrics: [
        { label: '产品', value: topWanTou.productName },
        { label: '万投比', value: formatWanTouRatio(topWanTou.displayRatio) },
        { label: '投诉数', value: String(topWanTou.totalComplaints) },
      ],
      sources: ['complaint_ticket'],
      drillTab: 'complaint_ticket',
    })
  }
  highlights.push(...risks)

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
    executiveSummary: executiveParts.join(''),
    dataCoverageNotes,
    highlights,
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
