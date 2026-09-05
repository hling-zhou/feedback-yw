import { TAG_CORRECTION_MIN_EVIDENCE, TAG_CORRECTION_MIN_MONTHS } from './constants.js'
import { correctionPairKey } from './tagCorrectionEvent.js'
import { correctionRulePairKey } from './tagCorrectionRules.js'

const STOPWORDS = new Set([
  '工单', '请问', '你好', '这个', '那个', '我们', '可以', '需要', '希望', '处理',
  '问题', '无法', '帮忙', '谢谢', '客户', '反馈', '已经', '一下', '怎么', '如何',
  '什么', '不是', '还是', '一个', '现在', '之前', '然后', '因为', '所以', '但是',
  '如果', '或者', '以及', '还有', '进行', '相关', '情况', '目前', '目前', '协助',
])

const TICKET_ID_RE = /[A-Za-z]{2,}\d{6,}|\d{10,}|eip-|i-\w+|slb-|vpc-/i

/**
 * @param {string} text
 * @returns {string[]}
 */
export function extractKeywordCandidates(text) {
  const cleaned = String(text || '')
    .replace(TICKET_ID_RE, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
  /** @type {string[]} */
  const tokens = []
  const latin = cleaned.match(/[a-zA-Z][a-zA-Z0-9_-]{2,}/g) || []
  for (const w of latin) {
    const t = w.toLowerCase()
    if (!STOPWORDS.has(t)) tokens.push(t)
  }
  const han = cleaned.match(/[\u4e00-\u9fff]{2,8}/g) || []
  for (const w of han) {
    if (STOPWORDS.has(w)) continue
    tokens.push(w)
    if (w.length >= 4) {
      for (let i = 0; i <= w.length - 2; i += 1) {
        const gram = w.slice(i, i + 2)
        if (!STOPWORDS.has(gram)) tokens.push(gram)
      }
    }
  }
  return [...new Set(tokens)]
}

/**
 * @param {import('./tagCorrectionEvent.js').TagCorrectionEvent[]} events
 * @param {import('../types.js').FeedbackRecord[]} [records]
 * @param {import('./tagCorrectionRules.js').TagCorrectionRule[]} [existingRules]
 */
export function mineTagCorrectionCandidates(events, records = [], existingRules = []) {
  /** @type {Map<string, {
   *   dimension: import('./constants.js').TagCorrectionDimension
   *   productKey: string
   *   fromLabel: string
   *   toLabel: string
   *   events: import('./tagCorrectionEvent.js').TagCorrectionEvent[]
   * }>} */
  const groups = new Map()

  for (const event of events || []) {
    const key = correctionPairKey(event)
    const prev = groups.get(key)
    if (prev) prev.events.push(event)
    else {
      groups.set(key, {
        dimension: event.dimension,
        productKey: event.dimension === 'journey' ? event.productKey || '' : '',
        fromLabel: event.systemLabel,
        toLabel: event.userLabel,
        events: [event],
      })
    }
  }

  const ruleByPair = new Map((existingRules || []).map((r) => [correctionRulePairKey(r), r]))
  const controlByLabel = buildControlTokenSets(records)

  /** @type {import('./tagCorrectionRules.js').TagCorrectionRule[]} */
  const candidates = []
  for (const [pairKey, group] of groups) {
    const months = new Set(
      group.events.map((e) => String(e.createdAt || '').slice(0, 7)).filter((m) => /^\d{4}-\d{2}$/.test(m)),
    )
    if (group.events.length < TAG_CORRECTION_MIN_EVIDENCE && months.size < TAG_CORRECTION_MIN_MONTHS) {
      continue
    }

    const existing = ruleByPair.get(pairKey)
    const keywords = existing?.keywords?.length
      ? existing.keywords
      : mineDistinctKeywords(group.events, controlByLabel.get(`${group.dimension}::${group.fromLabel}`))

    const samples = group.events.slice(0, 5).map((e) => ({
      recordId: e.recordId,
      taggingText: e.taggingText,
    }))

    candidates.push({
      id: existing?.id || pairKey,
      dimension: group.dimension,
      productKey: group.productKey,
      fromLabel: group.fromLabel,
      toLabel: group.toLabel,
      keywords,
      evidenceCount: group.events.length,
      distinctMonths: months.size,
      samples,
      status: existing?.status || 'pending',
      reviewNote: existing?.reviewNote,
      reviewedAt: existing?.reviewedAt,
      createdAt: existing?.createdAt || group.events[group.events.length - 1]?.createdAt || new Date().toISOString(),
      updatedAt: existing?.updatedAt,
    })
  }

  return candidates.sort((a, b) => b.evidenceCount - a.evidenceCount)
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
function buildControlTokenSets(records) {
  /** @type {Map<string, Set<string>>} */
  const map = new Map()
  for (const record of records || []) {
    const text = `${record.customerRequest || ''} ${record.painPoint || ''}`
    const tokens = extractKeywordCandidates(text)
    for (const dim of /** @type {const} */ (['requestScene', 'problemType'])) {
      const label = String(record[dim] || '').trim()
      if (!label) continue
      const key = `${dim}::${label}`
      if (!map.has(key)) map.set(key, new Set())
      const set = map.get(key)
      for (const t of tokens) set.add(t)
    }
  }
  return map
}

/**
 * @param {import('./tagCorrectionEvent.js').TagCorrectionEvent[]} events
 * @param {Set<string> | undefined} controlTokens
 */
function mineDistinctKeywords(events, controlTokens) {
  /** @type {Map<string, number>} */
  const counts = new Map()
  for (const event of events) {
    for (const token of extractKeywordCandidates(event.taggingText)) {
      counts.set(token, (counts.get(token) || 0) + 1)
    }
  }
  return [...counts.entries()]
    .filter(([token, n]) => {
      if (n < 2 || token.length < 2) return false
      if (!controlTokens?.has(token)) return true
      return n >= Math.max(2, Math.ceil(events.length / 2))
    })
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([token]) => token)
}
