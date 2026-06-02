import { CLUSTERING_VERSION } from '../lib/painPointClustering/constants.js'
import { buildClusterRecommendationsFromPipeline } from '../lib/painPointClustering/buildClusterActionRecommendations.js'
import { formatClusteringExclusionNote } from '../lib/painPointClustering/clusteringSnapshot.js'
import { limitPlanningRecommendations } from '../lib/planningRecommendations.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('../lib/storage.js').AppSettings} AppSettings */

/** 概览展示：旧快照不展示行动建议时的提示文案 */
export const OVERVIEW_RECOMMENDATIONS_REFRESH_NOTE =
  '行动建议需通过「生成 / 刷新洞察」基于痛点聚类生成。当前快照未包含有效结果，暂不展示行动建议。'

/** 痛点聚类无 Top 10 时的提示文案（不展示行动建议列表） */
export const OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE =
  '本期未形成痛点聚类 Top 10（需有效「需求痛点挖掘」且二次聚类非空），暂不展示行动建议。'

/**
 * @param {OverviewConclusions | null | undefined} conclusions
 */
export function needsOverviewRecommendationsRehydrate(conclusions) {
  if (!conclusions || conclusions.insufficientData) return false
  const meta = conclusions.recommendationsMeta
  const engine = meta?.recommendationEngine
  if (!engine) return true
  if (engine !== 'pain_cluster_v2') return true
  if (meta?.legacyFallback === true) return true
  return false
}

/**
 * 概览 Tab 只读展示：旧/legacy 快照不展示行动建议，仅保留其余结论字段。
 *
 * @param {OverviewConclusions | null | undefined} conclusions
 * @returns {{ conclusions: OverviewConclusions | null | undefined; recommendationsPendingRefresh: boolean }}
 */
export function prepareOverviewConclusionsForDisplay(conclusions) {
  if (!conclusions || !needsOverviewRecommendationsRehydrate(conclusions)) {
    return { conclusions, recommendationsPendingRefresh: false }
  }

  const notes = [...(conclusions.dataCoverageNotes || [])]
  if (!notes.includes(OVERVIEW_RECOMMENDATIONS_REFRESH_NOTE)) {
    notes.push(OVERVIEW_RECOMMENDATIONS_REFRESH_NOTE)
  }

  return {
    conclusions: {
      ...conclusions,
      recommendations: [],
      recommendationsMeta: {
        ...conclusions.recommendationsMeta,
        displaySuppressed: true,
      },
      dataCoverageNotes: notes,
    },
    recommendationsPendingRefresh: true,
  }
}

/**
 * @param {OverviewConclusions} conclusions
 * @param {FeedbackRecord[]} ticketRecords
 * @param {AppSettings | null | undefined} [settings]
 * @returns {OverviewConclusions}
 */
export function rehydrateOverviewRecommendations(conclusions, ticketRecords, settings) {
  const meta = conclusions.recommendationsMeta
  if (
    meta?.recommendationEngine === 'pain_cluster_v2' &&
    meta?.legacyFallback !== true &&
    !meta?.rehydratedAt
  ) {
    return conclusions
  }
  if (!needsOverviewRecommendationsRehydrate(conclusions)) return conclusions

  /** @type {string[]} */
  const notes = [...(conclusions.dataCoverageNotes || [])]

  if (!ticketRecords.length) {
    return {
      ...conclusions,
      recommendations: [],
      recommendationsMeta: {
        ...conclusions.recommendationsMeta,
        ruleVersion: `pain-cluster-${CLUSTERING_VERSION}`,
        recommendationEngine: 'pain_cluster_v2',
        legacyFallback: false,
        rehydratedAt: new Date().toISOString(),
        generatedRecommendationCount: 0,
        cappedCount: 0,
      },
      dataCoverageNotes: [
        ...notes,
        '当前周期无工单数据，无法生成行动建议；请重新生成洞察快照。',
      ],
    }
  }

  const { recommendations: raw, pipelineResults } = buildClusterRecommendationsFromPipeline(
    ticketRecords,
    { settings },
  )

  const exclusionNote = formatClusteringExclusionNote(pipelineResults)
  if (exclusionNote && !notes.includes(exclusionNote)) notes.push(exclusionNote)

  if (!raw.length) {
    if (!notes.includes(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)) {
      notes.push(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)
    }
    return {
      ...conclusions,
      recommendations: [],
      recommendationsMeta: {
        ...conclusions.recommendationsMeta,
        ruleVersion: `pain-cluster-${CLUSTERING_VERSION}`,
        recommendationEngine: 'pain_cluster_v2',
        legacyFallback: false,
        rehydratedAt: new Date().toISOString(),
        generatedRecommendationCount: 0,
        cappedCount: 0,
      },
      dataCoverageNotes: notes,
    }
  }

  const limited = limitPlanningRecommendations(raw)
  notes.push('行动建议已基于当前工单实时重算（快照生成于聚类引擎上线前，建议重新生成洞察快照以持久化）。')

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
