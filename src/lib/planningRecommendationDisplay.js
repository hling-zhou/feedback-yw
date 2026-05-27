import { recommendationCompareKey } from './planningRecommendationCompare.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').RecommendationUserOverride} RecommendationUserOverride */

export const WORKFLOW_STATUS_LABELS = {
  accepted: '已采纳',
  in_progress: '进行中',
  done: '已完成',
  dismissed: '不适用',
}

/**
 * @param {OverviewRecommendation} rec
 */
export function resolveEffectiveRecommendation(rec) {
  const override = rec.userOverride
  if (!override) return rec
  return {
    ...rec,
    summary: override.summary?.trim() || rec.summary || rec.text,
    text: override.summary?.trim() || rec.summary || rec.text,
    details: override.details?.length ? override.details : rec.details,
    priority: rec.priority,
    category: rec.category,
  }
}

/**
 * @param {OverviewRecommendation[]} recommendations
 */
export function resolveEffectiveRecommendations(recommendations) {
  return (recommendations || []).map(resolveEffectiveRecommendation)
}

/**
 * @param {OverviewRecommendation[]} newRecs
 * @param {OverviewRecommendation[]} [oldRecs]
 */
export function preserveRecommendationUserOverrides(newRecs, oldRecs = []) {
  /** @type {Map<string, RecommendationUserOverride>} */
  const overrideByKey = new Map()
  for (const rec of oldRecs) {
    if (rec.userOverride) {
      overrideByKey.set(recommendationCompareKey(rec), rec.userOverride)
    }
  }
  return newRecs.map((rec) => {
    const override = overrideByKey.get(recommendationCompareKey(rec))
    if (!override) return rec
    return { ...rec, userOverride: override }
  })
}

/**
 * @param {OverviewRecommendation[]} recs
 * @param {'high' | 'medium' | 'low'} priority
 * @param {import('../domain/overviewConclusions.js').RecommendationCategory} category
 * @param {number} [max]
 */
export function recommendationsForMatrixCell(recs, priority, category, max = 2) {
  return recs
    .filter((r) => r.priority === priority && r.category === category)
    .slice(0, max)
}

/**
 * @param {OverviewRecommendation[]} recs
 */
export function groupRecommendationsByProduct(recs) {
  /** @type {Map<string, OverviewRecommendation[]>} */
  const map = new Map()
  for (const rec of recs) {
    const product = rec.scope?.product?.trim() || '跨产品'
    if (!map.has(product)) map.set(product, [])
    map.get(product).push(rec)
  }
  return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
}
