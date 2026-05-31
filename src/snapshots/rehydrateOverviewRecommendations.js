import { CLUSTERING_VERSION } from '../lib/painPointClustering/constants.js'
import { buildClusterRecommendationsFromPipeline } from '../lib/painPointClustering/buildClusterActionRecommendations.js'
import { formatClusteringExclusionNote } from '../lib/painPointClustering/clusteringSnapshot.js'
import { limitPlanningRecommendations } from '../lib/planningRecommendations.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../lib/storage.js').AppSettings} AppSettings */

/**
 * 旧版概览快照（无 recommendationEngine）需在展示时用当前工单重算行动建议
 * @param {OverviewConclusions | null | undefined} conclusions
 */
export function needsOverviewRecommendationsRehydrate(conclusions) {
  if (!conclusions || conclusions.insufficientData) return false
  return !conclusions.recommendationsMeta?.recommendationEngine
}

/**
 * @param {OverviewConclusions} conclusions
 * @param {FeedbackRecord[]} ticketRecords
 * @param {AppSettings | null | undefined} [settings]
 * @returns {OverviewConclusions}
 */
export function rehydrateOverviewRecommendations(conclusions, ticketRecords, settings) {
  if (!needsOverviewRecommendationsRehydrate(conclusions)) return conclusions

  /** @type {string[]} */
  const notes = [...(conclusions.dataCoverageNotes || [])]

  if (!ticketRecords.length) {
    return {
      ...conclusions,
      recommendationsMeta: {
        ...conclusions.recommendationsMeta,
        recommendationEngine: 'legacy_planning',
        legacyFallback: true,
        rehydratedAt: new Date().toISOString(),
      },
      dataCoverageNotes: [
        ...notes,
        '当前周期无工单数据，无法重算 V2 行动建议；请重新生成洞察快照。',
      ],
    }
  }

  const { recommendations: raw, pipelineResults } = buildClusterRecommendationsFromPipeline(
    ticketRecords,
    { settings },
  )

  if (!raw.length) {
    if (conclusions.recommendations?.length) {
      return {
        ...conclusions,
        recommendationsMeta: {
          ...conclusions.recommendationsMeta,
          recommendationEngine: 'legacy_planning',
          legacyFallback: true,
          rehydratedAt: new Date().toISOString(),
        },
        dataCoverageNotes: [
          ...notes,
          '行动建议仍来自旧版快照（V2 聚类暂无结果）；请重新生成洞察快照以完全切换至 V2。',
        ],
      }
    }
    return {
      ...conclusions,
      recommendations: [],
      recommendationsMeta: {
        ...conclusions.recommendationsMeta,
        recommendationEngine: 'legacy_planning',
        legacyFallback: true,
        rehydratedAt: new Date().toISOString(),
        generatedRecommendationCount: 0,
        cappedCount: 0,
      },
      dataCoverageNotes: [
        ...notes,
        'V2 痛点聚类未形成 Top 10；请确认工单已打标「需求痛点挖掘」后重新生成洞察快照。',
      ],
    }
  }

  const limited = limitPlanningRecommendations(raw)
  const exclusionNote = formatClusteringExclusionNote(pipelineResults)
  if (exclusionNote && !notes.includes(exclusionNote)) notes.push(exclusionNote)
  notes.push('行动建议已基于当前工单实时重算（快照生成于 V2 聚类上线前，建议重新生成洞察快照以持久化）。')

  return {
    ...conclusions,
    recommendations: limited,
    recommendationsMeta: {
      ...conclusions.recommendationsMeta,
      ruleVersion: `pain-cluster-${CLUSTERING_VERSION}`,
      recommendationEngine: 'pain_cluster_v2',
      legacyFallback: false,
      rehydratedAt: new Date().toISOString(),
      generatedRecommendationCount: raw.length,
      cappedCount: limited.length,
    },
    dataCoverageNotes: notes,
  }
}
