import { DATA_SOURCE_SHORT_LABEL } from './constants.js'
import { runMultiProductClusteringPipeline } from './runProductClusteringPipeline.js'

/** @typedef {import('./runProductClusteringPipeline.js').ProductClusteringResult} ProductClusteringResult */
import { countCustomerTiers } from '../../domain/customerTier.js'
import {
  attachPlanningRecommendationSections,
  ensureMinProductActions,
  enforcePlanningSectionRules,
} from '../planningRecommendationSections.js'
import {
  computeRecommendationEvidenceStrength,
  pickEvidenceRecords,
} from '../planningRecommendations.js'

/** @typedef {import('./priorityScore.js').ScoredFinalCluster} ScoredFinalCluster */
/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').PainClusterScoreMeta} PainClusterScoreMeta */
/** @typedef {import('../domain/overviewConclusions.js').PlanningRecommendationSections} PlanningRecommendationSections */
/** @typedef {import('../types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../lib/storage.js').AppSettings} AppSettings */

/**
 * @param {number} priorityScore
 * @returns {'high' | 'medium' | 'low'}
 */
export function mapClusterPriorityScore(priorityScore) {
  if (priorityScore >= 4) return 'high'
  if (priorityScore >= 3) return 'medium'
  return 'low'
}

/**
 * @param {Record<string, number>} tierCounts
 */
export function formatCustomerTierSummary(tierCounts) {
  const parts = []
  for (const tier of ['金牌', '银牌', '铜牌', '普通']) {
    const n = tierCounts[tier] || 0
    if (n > 0) parts.push(`${tier}${n}`)
  }
  return parts.join('，') || '—'
}

/**
 * @param {ScoredFinalCluster} cluster
 * @param {FeedbackRecord[]} records
 */
export function buildClusterSourceDistributionLines(cluster, records) {
  const byId = new Map(records.map((r) => [r.id, r]))
  /** @type {Map<string, { count: number; l1: Map<string, number> }>} */
  const bySource = new Map()

  for (const pg of cluster.primaryGroups || []) {
    const label = DATA_SOURCE_SHORT_LABEL[pg.dataSourceType] || pg.dataSourceType
    if (!bySource.has(label)) bySource.set(label, { count: 0, l1: new Map() })
    const entry = bySource.get(label)
    for (const id of pg.recordIds) {
      if (!cluster.recordIds.includes(id)) continue
      entry.count += 1
      const r = byId.get(id)
      const l1 = r?.journeyL1?.trim() || pg.journeyL1 || '未识别环节'
      entry.l1.set(l1, (entry.l1.get(l1) || 0) + 1)
    }
  }

  const total = cluster.ticketCount || 0
  return [...bySource.entries()].map(([source, { count, l1 }]) => {
    const sharePct = total > 0 ? Math.round((count / total) * 100) : 0
    const l1Parts = [...l1.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([name, n]) => `${name}(${n}件)`)
      .join('、')
    return `${source}：${count}件（占比${sharePct}%）${l1Parts ? `，涉及一级环节：${l1Parts}` : ''}`
  })
}

/**
 * @param {ScoredFinalCluster} cluster
 * @param {FeedbackRecord[]} records
 * @returns {PainClusterScoreMeta}
 */
export function buildPainClusterScoreMeta(cluster, records) {
  const tierCounts = countCustomerTiers(records)
  return {
    priorityScore: round1(cluster.priorityScore),
    rank: cluster.rank,
    totalFinal: cluster.totalFinal,
    breadthScore: cluster.breadthScore,
    sharePct: round1(cluster.sharePct),
    ticketCount: cluster.ticketCount,
    harmScore: round1(cluster.harmScore),
    maxSeverity: cluster.maxSeverity,
    p90Emotion: round1(cluster.p90Emotion),
    sourceDistributionLines: buildClusterSourceDistributionLines(cluster, records),
    customerTierSummary: formatCustomerTierSummary(tierCounts),
    customerTierCounts: tierCounts,
  }
}

/**
 * @param {number} n
 */
function round1(n) {
  return Math.round((n || 0) * 10) / 10
}

/**
 * @param {ScoredFinalCluster} cluster
 * @param {FeedbackRecord[]} allRecords
 * @param {AppSettings | null | undefined} [settings]
 * @returns {OverviewRecommendation | null}
 */
export function scoredFinalClusterToRecommendation(cluster, allRecords, settings = null) {
  const byId = new Map(allRecords.map((r) => [r.id, r]))
  const records = cluster.recordIds.map((id) => byId.get(id)).filter(Boolean)
  if (!records.length) return null

  const label = cluster.representativePainPoint || cluster.label || '未命名痛点群组'
  const painClusterScores = buildPainClusterScoreMeta(cluster, records)
  const { ticketIds } = pickEvidenceRecords(records, 20)

  const stub = {
    id: cluster.id,
    priority: mapClusterPriorityScore(cluster.priorityScore),
    category: /** @type {const} */ ('product'),
    summary: label,
    text: label,
    signalType: 'pain_cluster_v2',
    scope: { product: cluster.product },
    evidenceRecordIds: cluster.recordIds,
    evidenceTicketIds: ticketIds,
    evidenceNote: `V2 二次聚类 Top ${cluster.rank}/${cluster.totalFinal} · ${cluster.product}`,
    evidenceBundle: {
      ticketCount: cluster.ticketCount,
      sharePct: cluster.sharePct,
    },
    generationMeta: {
      selectedReason: `痛点聚类 V2：优先级 ${painClusterScores.priorityScore} 分（排名 ${cluster.rank}/${cluster.totalFinal}），影响广度 ${painClusterScores.breadthScore} 分，业务危害度 ${painClusterScores.harmScore} 分。`,
      score: cluster.priorityScore,
    },
    measureSource: settings?.optimizationMode === 'llm' ? 'cluster_rule' : 'cluster_rule',
    insufficientEvidence: cluster.ticketCount < 3,
  }

  const attached = attachPlanningRecommendationSections(stub, records)
  /** @type {PlanningRecommendationSections} */
  let sections = {
    ...attached.sections,
    executiveSummary: label,
    painClusterScores,
  }
  sections = enforcePlanningSectionRules(ensureMinProductActions(sections, attached.details || []))

  const evidenceStrength = computeRecommendationEvidenceStrength(
    records,
    stub.insufficientEvidence,
    stub.measureSource,
  )

  return {
    ...attached,
    sections,
    summary: label,
    text: label,
    evidenceStrength,
  }
}

/**
 * @param {FeedbackRecord[]} ticketRecords
 * @param {{ settings?: AppSettings | null; pipelineResults?: ProductClusteringResult[] }} [options]
 */
export function buildClusterRecommendationsFromPipeline(ticketRecords, options = {}) {
  if (!ticketRecords?.length) {
    return { recommendations: [], pipelineResults: [] }
  }

  const pipelineResults =
    options.pipelineResults ?? runMultiProductClusteringPipeline(ticketRecords)

  /** @type {OverviewRecommendation[]} */
  const recommendations = []

  for (const productResult of pipelineResults) {
    for (const cluster of productResult.topFinalClusters) {
      const rec = scoredFinalClusterToRecommendation(
        cluster,
        ticketRecords,
        options.settings,
      )
      if (rec) recommendations.push(rec)
    }
  }

  recommendations.sort((a, b) => {
    const scoreA = a.generationMeta?.score ?? 0
    const scoreB = b.generationMeta?.score ?? 0
    if (scoreB !== scoreA) return scoreB - scoreA
    const harmA = a.sections?.painClusterScores?.harmScore ?? 0
    const harmB = b.sections?.painClusterScores?.harmScore ?? 0
    return harmB - harmA
  })

  return { recommendations, pipelineResults }
}

/**
 * 洞察概览行动建议：各产品 Top 10 最终痛点群组（V2）
 *
 * @param {FeedbackRecord[]} ticketRecords 周期内投诉+咨询工单
 * @param {{ settings?: AppSettings | null }} [options]
 * @returns {OverviewRecommendation[]}
 */
export function buildClusterActionRecommendations(ticketRecords, options = {}) {
  return buildClusterRecommendationsFromPipeline(ticketRecords, options).recommendations
}
