import { startOfWeek, parseISO, format, isValid } from 'date-fns'
import {
  isNegativeSentiment,
  normalizeSentiment,
  SENTIMENT_LABELS,
  SENTIMENT_ORDER,
} from './sentiment.js'

export function monthFromValue(value) {
  if (!value) return ''
  const str = String(value)
  const direct = str.match(/^(\d{4})[-/](\d{1,2})/)
  if (direct) return `${direct[1]}-${direct[2].padStart(2, '0')}`
  const d = parseISO(str)
  return isValid(d) ? format(d, 'yyyy-MM') : ''
}

/**
 * @param {import('./types.js').FeedbackRecord} fb
 * @param {'createdAt' | 'importMonth'} basis
 */
export function recordMonth(fb, basis = 'createdAt') {
  if (basis === 'importMonth') {
    return fb.importMonth || monthFromValue(fb.importedAt) || monthFromValue(fb.createdAt) || '未知月份'
  }
  return monthFromValue(fb.createdAt) || fb.importMonth || monthFromValue(fb.importedAt) || '未知月份'
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 */
export function computeStats(feedbacks) {
  const now = new Date()
  const weekStart = startOfWeek(now, { weekStartsOn: 1 })

  let thisWeek = 0
  let negative = 0
  let open = 0

  for (const fb of feedbacks) {
    if (isNegativeSentiment(fb.sentiment)) negative += 1
    if (fb.status === 'open') open += 1
    const d = fb.createdAt ? parseISO(fb.createdAt) : null
    if (d && isValid(d) && d >= weekStart) thisWeek += 1
  }

  return {
    total: feedbacks.length,
    thisWeek,
    negativePct: feedbacks.length ? Math.round((negative / feedbacks.length) * 100) : 0,
    open,
  }
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 */
export function trendByDay(feedbacks) {
  /** @type {Map<string, number>} */
  const map = new Map()

  for (const fb of feedbacks) {
    let key = fb.createdAt?.slice(0, 10) || '未知'
    if (key !== '未知') {
      const d = parseISO(key)
      if (isValid(d)) key = format(d, 'MM/dd')
    }
    map.set(key, (map.get(key) || 0) + 1)
  }

  return [...map.entries()]
    .map(([date, count]) => ({ date, count }))
    .slice(-14)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 */
export function sentimentDistribution(feedbacks) {
  const total = feedbacks.length
  /** @type {Record<string, number>} */
  const counts = {}
  for (const fb of feedbacks) {
    const key = normalizeSentiment(fb.sentiment)
    counts[key] = (counts[key] || 0) + 1
  }
  return SENTIMENT_ORDER.map((key) => ({
    name: SENTIMENT_LABELS[key],
    value: counts[key] || 0,
    key,
    pct: total ? Math.round(((counts[key] || 0) / total) * 100) : 0,
  })).filter((d) => d.value > 0)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 */
export function sentimentStats(feedbacks) {
  const distribution = sentimentDistribution(feedbacks)
  const total = feedbacks.length
  let negativeCount = 0
  for (const fb of feedbacks) {
    if (isNegativeSentiment(fb.sentiment)) negativeCount += 1
  }
  const top = [...distribution].sort((a, b) => b.value - a.value)[0]
  return {
    total,
    negativeCount,
    negativePct: total ? Math.round((negativeCount / total) * 100) : 0,
    topLabel: top?.name || '—',
    topCount: top?.value || 0,
    topPct: top?.pct || 0,
    distribution,
  }
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {{ basis?: 'createdAt' | 'importMonth'; limit?: number }} [options]
 */
export function monthlyTrend(feedbacks, options = {}) {
  const basis = options.basis || 'createdAt'
  const limit = options.limit || 12
  const map = new Map()

  for (const fb of feedbacks) {
    const month = recordMonth(fb, basis)
    if (!map.has(month)) {
      map.set(month, {
        date: month,
        count: 0,
        negative: 0,
        actioned: 0,
      })
    }
    const entry = map.get(month)
    entry.count += 1
    if (isNegativeSentiment(fb.sentiment)) entry.negative += 1
    if (fb.status === 'actioned') entry.actioned += 1
  }

  return [...map.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .slice(-limit)
    .map((d) => ({
      ...d,
      negativePct: d.count ? Math.round((d.negative / d.count) * 100) : 0,
    }))
}

/**
 * @param {import('./types.js').FeedbackRecord[]} feedbacks
 * @param {'createdAt' | 'importMonth'} [basis]
 */
export function listRecordMonths(feedbacks, basis = 'importMonth') {
  const map = new Map()
  for (const fb of feedbacks) {
    const month = recordMonth(fb, basis)
    map.set(month, (map.get(month) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([name, count]) => ({ name, count }))
}
