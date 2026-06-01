import { isNegativeSentiment } from './sentiment.js'
import { getComplaintCauseL1Display, isComplaintTicket } from '../domain/complaintCause.js'
import { getCommonOptimizationText } from './ticketAnalysis/ticketAnalysisSources.js'

/**
 * 按字段聚合（支持 themes 等多值字段）
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {keyof import('./types.js').FeedbackRecord | 'themes'} field
 * @param {{ multi?: boolean }} [opts]
 */
export function aggregateFieldInsights(items, field, opts = {}) {
  const multi = opts.multi ?? field === 'themes'
  /** @type {Map<string, { label: string; count: number; negative: number; latest: string | null; ids: string[] }>} */
  const map = new Map()

  for (const fb of items) {
    /** @type {string[]} */
    let values
    if (multi) {
      const raw = fb[field]
      values = Array.isArray(raw) && raw.length ? raw : ['未分类']
    } else {
      const v = fb[field]
      values = [typeof v === 'string' && v.trim() ? v.trim() : '未分类']
    }

    for (const label of values) {
      if (!map.has(label)) {
        map.set(label, { label, count: 0, negative: 0, latest: null, ids: [] })
      }
      const entry = map.get(label)
      entry.count += 1
      if (isNegativeSentiment(fb.sentiment)) entry.negative += 1
      entry.ids.push(fb.id)
      if (fb.createdAt && (!entry.latest || fb.createdAt > entry.latest)) {
        entry.latest = fb.createdAt
      }
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 */
export function countByField(items, field) {
  const map = new Map()
  for (const fb of items) {
    const v = fb[field]?.trim() || '未分类'
    map.set(v, (map.get(v) || 0) + 1)
  }
  return [...map.entries()]
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 */
export function aggregateJourney(items) {
  /** @type {Map<string, { l1: string; l2: string; count: number; solutions: string[]; ids: string[] }>} */
  const map = new Map()

  for (const fb of items) {
    const l1 = fb.journeyL1 || '未识别环节'
    const l2 = fb.journeyL2 || '未识别子环节'
    const key = `${l1}::${l2}`
    if (!map.has(key)) {
      map.set(key, { l1, l2, count: 0, solutions: [], ids: [] })
    }
    const e = map.get(key)
    e.count += 1
    e.ids.push(fb.id)
    if (fb.solutionSummary?.trim()) {
      e.solutions.push(fb.solutionSummary.slice(0, 120))
    }
  }

  return [...map.values()].sort((a, b) => b.count - a.count)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 */
export function journeyTree(items) {
  /** @type {Map<string, { l1: string; count: number; children: Map<string, { l2: string; count: number; ids: string[] }> }>} */
  const tree = new Map()

  for (const fb of items) {
    const l1 = fb.journeyL1 || '未识别环节'
    const l2 = fb.journeyL2 || '未识别子环节'
    if (!tree.has(l1)) tree.set(l1, { l1, count: 0, children: new Map() })
    const node = tree.get(l1)
    node.count += 1
    if (!node.children.has(l2)) node.children.set(l2, { l2, count: 0, ids: [] })
    const child = node.children.get(l2)
    child.count += 1
    child.ids.push(fb.id)
  }

  return [...tree.values()].map((n) => ({
    l1: n.l1,
    count: n.count,
    children: [...n.children.values()].sort((a, b) => b.count - a.count),
  })).sort((a, b) => b.count - a.count)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} all
 * @param {{
 *   product?: string
 *   resourcePool?: string
 *   journeyL1?: string
 *   journeyL2?: string
 *   problemType?: string
 *   requestScene?: string
 *   complaintCauseL1?: string
 * }} filters
 */
export function filterFeedbacks(all, filters) {
  return all.filter((fb) => {
    if (filters.product && fb.product !== filters.product) return false
    if (filters.resourcePool && (fb.resourcePool || '未标注资源池') !== filters.resourcePool) return false
    if (filters.journeyL1 && fb.journeyL1 !== filters.journeyL1) return false
    if (filters.journeyL2 && fb.journeyL2 !== filters.journeyL2) return false
    if (filters.problemType && (fb.problemType || '未分类') !== filters.problemType) return false
    if (filters.requestScene && (fb.requestScene || '未分类') !== filters.requestScene) return false
    if (filters.complaintCauseL1) {
      if (!isComplaintTicket(fb)) return false
      if (getComplaintCauseL1Display(fb) !== filters.complaintCauseL1) return false
    }
    return true
  })
}

/**
 * 按优化建议文案聚合 Top N（可选按旅程过滤）。
 * @param {import('./types.js').FeedbackRecord[]} items
 * @param {string} [journeyL1]
 * @param {string} [journeyL2]
 * @param {{ limit?: number; keyLength?: number }} [opts]
 */
export function topCommonOptimizations(items, journeyL1, journeyL2, opts = {}) {
  const limit = opts.limit ?? 5
  const keyLength = opts.keyLength ?? 80
  const filtered = items.filter(
    (fb) =>
      (!journeyL1 || fb.journeyL1 === journeyL1) &&
      (!journeyL2 || fb.journeyL2 === journeyL2),
  )
  const map = new Map()
  for (const fb of filtered) {
    const s = getCommonOptimizationText(fb)?.trim()
    if (!s) continue
    const key = s.slice(0, keyLength)
    map.set(key, (map.get(key) || 0) + 1)
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }))
}

/** @deprecated 使用 topCommonOptimizations */
export function topSolutionsByJourney(items, journeyL1, journeyL2) {
  return topCommonOptimizations(items, journeyL1, journeyL2)
}
