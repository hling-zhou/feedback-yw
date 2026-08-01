import { recommendationAxisKey, recommendationStableCompareKey } from './planningRecommendations.js'

/** @typedef {import('../domain/overviewConclusions.js').OverviewRecommendation} OverviewRecommendation */
/** @typedef {import('../domain/overviewConclusions.js').RecommendationPeriodCompare} RecommendationPeriodCompare */

const PRIORITY_RANK = { high: 3, medium: 2, low: 1 }

/**
 * @param {OverviewRecommendation} rec
 */
export function recommendationCompareKey(rec) {
  return recommendationStableCompareKey(rec) || `${rec.signalType || ''}:${recommendationAxisKey(rec)}`
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

function deriveLifecycle(currentRec, previousRec) {
  if (!previousRec) return 'new'
  const currentScore = currentRec?.generationMeta?.score ?? 0
  const previousScore = previousRec?.generationMeta?.score ?? 0
  const currentCount =
    currentRec?.sections?.painClusterScores?.ticketCount
    ?? currentRec?.evidenceBundle?.ticketCount
    ?? currentRec?.evidenceRecordIds?.length
    ?? 0
  const previousCount =
    previousRec?.sections?.painClusterScores?.ticketCount
    ?? previousRec?.evidenceBundle?.ticketCount
    ?? previousRec?.evidenceRecordIds?.length
    ?? 0
  if (currentScore > previousScore + 0.35 || currentCount > previousCount) return 'growing'
  if (currentScore < previousScore - 0.35 || currentCount < previousCount) return 'easing'
  return 'persistent'
}

function sharePctOf(rec) {
  return rec?.sections?.painClusterScores?.sharePct ?? rec?.evidenceBundle?.sharePct ?? 0
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
      return {
        ...rec,
        periodCompare: /** @type {RecommendationPeriodCompare} */ ({
          change: 'new',
          lifecycle: 'new',
          deltaCount:
            rec?.sections?.painClusterScores?.ticketCount
            ?? rec?.evidenceBundle?.ticketCount
            ?? rec?.evidenceRecordIds?.length
            ?? 0,
          deltaSharePct: sharePctOf(rec),
        }),
      }
    }
    const change = comparePriorityChange(rec.priority, prev.priority)
    return {
      ...rec,
      periodCompare: {
        change,
        previousId: prev.id,
        previousPriority: prev.priority,
        lifecycle: deriveLifecycle(rec, prev),
        deltaCount:
          (rec?.sections?.painClusterScores?.ticketCount
            ?? rec?.evidenceBundle?.ticketCount
            ?? rec?.evidenceRecordIds?.length
            ?? 0)
          - (prev?.sections?.painClusterScores?.ticketCount
            ?? prev?.evidenceBundle?.ticketCount
            ?? prev?.evidenceRecordIds?.length
            ?? 0),
        deltaSharePct: Number((sharePctOf(rec) - sharePctOf(prev)).toFixed(1)),
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
    growing: 0,
    easing: 0,
  }
  for (const rec of recommendations) {
    const change = rec.periodCompare?.change || 'persist'
    counts[change] = (counts[change] || 0) + 1
    const lifecycle = rec.periodCompare?.lifecycle
    if (lifecycle === 'growing' || lifecycle === 'easing') {
      counts[lifecycle] = (counts[lifecycle] || 0) + 1
    }
  }
  return counts
}

export const PERIOD_COMPARE_LABELS = {
  new: '新增',
  persist: '持续',
  priority_up: '升级',
  priority_down: '降级',
  growing: '增长',
  easing: '缓解',
}
