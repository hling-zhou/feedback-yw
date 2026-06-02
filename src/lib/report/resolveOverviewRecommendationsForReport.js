import { limitPlanningRecommendations } from '../planningRecommendations.js'

/** @typedef {import('../../domain/overviewConclusions.js').OverviewConclusions} OverviewConclusions */
/** @typedef {import('../../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */

/**
 * PDF / 导出仅保留 V2 痛点聚类行动建议（不含旧规则引擎内容）
 * @param {OverviewConclusions | null | undefined} conclusions
 * @returns {OverviewRecommendation[]}
 */
export function resolveOverviewRecommendationsForReport(conclusions) {
  if (!conclusions || conclusions.insufficientData) return []

  const meta = conclusions.recommendationsMeta
  if (meta?.recommendationEngine !== 'pain_cluster_v2') return []
  if (meta?.legacyFallback === true) return []
  if (meta?.displaySuppressed === true) return []

  const v2Only = (conclusions.recommendations || []).filter(
    (rec) => rec.sections?.painClusterScores != null,
  )
  return limitPlanningRecommendations(v2Only)
}
