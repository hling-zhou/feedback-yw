import {
  getUrgencyLevel,
  isNegativeSentiment,
  normalizeSentiment,
  SENTIMENT_LABELS,
  SENTIMENT_ORDER,
} from './sentiment.js'

/** @typedef {import('./types.js').FeedbackRecord} FeedbackRecord */
/** @typedef {import('./sentiment.js').MainSentiment} MainSentiment */

/**
 * @param {FeedbackRecord} record
 */
export function journeyLabelFromRecord(record) {
  const l1 = record?.journeyL1?.trim() || '未识别环节'
  const l2 = record?.journeyL2?.trim()
  if (l2 && l2 !== '未识别子环节') return `${l1} > ${l2}`
  return l1
}

/**
 * @param {FeedbackRecord} record
 */
function problemTypeFromRecord(record) {
  return record?.problemType?.trim() || '未分类'
}

/**
 * @param {FeedbackRecord[]} records
 */
function emptySentimentCounts() {
  /** @type {Record<MainSentiment, number>} */
  const counts = {}
  for (const key of SENTIMENT_ORDER) counts[key] = 0
  return counts
}

/**
 * 情绪 × 旅程 × 问题类型 交叉统计（按工单量降序）
 *
 * @param {FeedbackRecord[]} records
 * @param {{ limit?: number }} [options]
 */
export function buildSentimentJourneyProblemCrossTab(records, options = {}) {
  const limit = options.limit ?? 40
  /** @type {Map<string, { journeyL1: string; journeyL2: string; journeyLabel: string; problemType: string; total: number; urgentCount: number; negativeCount: number; urgentNegativeCount: number; sentiments: Record<MainSentiment, number> }>} */
  const map = new Map()

  for (const fb of records) {
    const journeyLabel = journeyLabelFromRecord(fb)
    const problemType = problemTypeFromRecord(fb)
    const key = `${journeyLabel}\0${problemType}`
    if (!map.has(key)) {
      map.set(key, {
        journeyL1: fb.journeyL1?.trim() || '未识别环节',
        journeyL2: fb.journeyL2?.trim() || '',
        journeyLabel,
        problemType,
        total: 0,
        urgentCount: 0,
        negativeCount: 0,
        urgentNegativeCount: 0,
        sentiments: emptySentimentCounts(),
      })
    }
    const row = map.get(key)
    row.total += 1
    const urgent = getUrgencyLevel(fb) === 'high'
    const negative = isNegativeSentiment(fb.sentiment)
    if (urgent) row.urgentCount += 1
    if (negative) row.negativeCount += 1
    if (urgent && negative) row.urgentNegativeCount += 1
    const sentimentKey = normalizeSentiment(fb.sentiment)
    row.sentiments[sentimentKey] = (row.sentiments[sentimentKey] || 0) + 1
  }

  return [...map.values()]
    .sort((a, b) => b.total - a.total || b.urgentNegativeCount - a.urgentNegativeCount)
    .slice(0, limit)
    .map((row, i) => ({
      ...row,
      key: `${row.journeyLabel}-${row.problemType}-${i}`,
      negativePct: row.total ? Math.round((row.negativeCount / row.total) * 100) : 0,
      urgentPct: row.total ? Math.round((row.urgentCount / row.total) * 100) : 0,
    }))
}

/**
 * 高加急 + 高负面 旅程 Top N（按「加急且负面」工单数排序）
 *
 * @param {FeedbackRecord[]} records
 * @param {{ limit?: number }} [options]
 */
export function rankUrgentNegativeJourneys(records, options = {}) {
  const limit = options.limit ?? 8
  /** @type {Map<string, { journeyL1: string; journeyL2: string; journeyLabel: string; total: number; urgentCount: number; negativeCount: number; urgentNegativeCount: number }>} */
  const map = new Map()

  for (const fb of records) {
    const journeyLabel = journeyLabelFromRecord(fb)
    if (!map.has(journeyLabel)) {
      map.set(journeyLabel, {
        journeyL1: fb.journeyL1?.trim() || '未识别环节',
        journeyL2: fb.journeyL2?.trim() || '',
        journeyLabel,
        total: 0,
        urgentCount: 0,
        negativeCount: 0,
        urgentNegativeCount: 0,
      })
    }
    const row = map.get(journeyLabel)
    row.total += 1
    const urgent = getUrgencyLevel(fb) === 'high'
    const negative = isNegativeSentiment(fb.sentiment)
    if (urgent) row.urgentCount += 1
    if (negative) row.negativeCount += 1
    if (urgent && negative) row.urgentNegativeCount += 1
  }

  return [...map.values()]
    .filter((row) => row.urgentNegativeCount > 0 || row.negativeCount > 0)
    .sort(
      (a, b) =>
        b.urgentNegativeCount - a.urgentNegativeCount ||
        b.negativeCount - a.negativeCount ||
        b.urgentCount - a.urgentCount,
    )
    .slice(0, limit)
    .map((row, i) => ({
      ...row,
      key: `urgent-journey-${i}`,
      urgentNegativePct: row.total ? Math.round((row.urgentNegativeCount / row.total) * 100) : 0,
      negativePct: row.total ? Math.round((row.negativeCount / row.total) * 100) : 0,
    }))
}

export { SENTIMENT_LABELS, SENTIMENT_ORDER }
