import { recommendationAxisKey } from './planningRecommendations.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').RecommendationPeriodCompare} RecommendationPeriodCompare */

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }

/**
 * @param {OverviewRecommendation} rec
 */
export function recommendationCompareKey(rec) {
  return `${rec.signalType || ''}:${recommendationAxisKey(rec)}`
}

/**
 * @param {'high' | 'medium' | 'low'} a
 * @param {'high' | 'medium' | 'low'} b
 */
function comparePriorityChange(a, b) {
  const da = PRIORITY_RANK[a] - PRIORITY_RANK[b]
  if (da > 0) return 'priority_up'
  if (da < 0) return 'priority_down'
  return 'persist'
}

/**
 * @param {OverviewRecommendation[]} current
 * @param {OverviewRecommendation[]} [previous]
 */
export function attachRecommendationPeriodCompare(current, previous = []) {
  /** @type {Map<string, OverviewRecommendation>} */
  const prevByKey = new Map()
  for (const rec of previous) {
    prevByKey.set(recommendationCompareKey(rec), rec)
  }

  const currentKeys = new Set()
  const withCompare = current.map((rec) => {
    const key = recommendationCompareKey(rec)
    currentKeys.add(key)
    const prev = prevByKey.get(key)
    if (!prev) {
      return { ...rec, periodCompare: /** @type {RecommendationPeriodCompare} */ ({ change: 'new' }) }
    }
    const change = comparePriorityChange(rec.priority, prev.priority)
    return {
      ...rec,
      periodCompare: {
        change,
        previousId: prev.id,
        previousPriority: prev.priority,
      },
    }
  })

  let removedFromPreviousCount = 0
  for (const key of prevByKey.keys()) {
    if (!currentKeys.has(key)) removedFromPreviousCount += 1
  }

  return { recommendations: withCompare, removedFromPreviousCount }
}

/**
 * @param {OverviewRecommendation[]} recommendations
 */
export function summarizeRecommendationPeriodCompare(recommendations) {
  /** @type {Record<string, number>} */
  const counts = {
    new: 0,
    persist: 0,
    priority_up: 0,
    priority_down: 0,
  }
  for (const rec of recommendations) {
    const change = rec.periodCompare?.change || 'persist'
    counts[change] = (counts[change] || 0) + 1
  }
  return counts
}

export const PERIOD_COMPARE_LABELS = {
  new: '新增',
  persist: '持续',
  priority_up: '升级',
  priority_down: '降级',
}
