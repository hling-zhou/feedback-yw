import { isValidUnifiedOptimization } from './validateUnifiedOptimization.js'

/** U-06 / O-golden 验收阈值 */
export const GOLDEN_REQUEST_PAIN_JACCARD_MIN = 0.85
export const GOLDEN_OPTIMIZATION_RATE_RATIO_MIN = 0.9

/**
 * @param {string} text
 * @returns {Set<string>}
 */
export function textTokenSet(text) {
  const normalized = (text || '').trim().toLowerCase()
  /** @type {Set<string>} */
  const tokens = new Set()
  const words = normalized.match(/[\u4e00-\u9fa5]{2,}|[a-z0-9]{2,}/gi) || []
  for (const word of words) {
    tokens.add(word)
    if (word.length > 2) {
      for (let i = 0; i < word.length - 1; i++) {
        tokens.add(word.slice(i, i + 2))
      }
    }
  }
  return tokens
}

/**
 * @param {string} a
 * @param {string} b
 */
export function textJaccardSimilarity(a, b) {
  const sa = textTokenSet(a)
  const sb = textTokenSet(b)
  if (!sa.size && !sb.size) return 1
  if (!sa.size || !sb.size) return 0
  let inter = 0
  for (const t of sa) {
    if (sb.has(t)) inter++
  }
  const union = sa.size + sb.size - inter
  return union > 0 ? inter / union : 0
}

/**
 * @param {{ customerRequest?: string; painPoint?: string }} a
 * @param {{ customerRequest?: string; painPoint?: string }} b
 */
export function requestPainJaccard(a, b) {
  const req = textJaccardSimilarity(a.customerRequest || '', b.customerRequest || '')
  const pain = textJaccardSimilarity(a.painPoint || '', b.painPoint || '')
  return (req + pain) / 2
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function recordHasNonGenericOptimization(record) {
  if (record?.optimizationSource !== 'llm') return false
  return isValidUnifiedOptimization({
    optimizationProduct: record.optimizationProduct,
    optimizationService: record.optimizationService,
  })
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function optimizationLlmNonGenericRate(records) {
  const ticketLike = records.filter((r) =>
    ['complaint_ticket', 'consultation_ticket'].includes(r.dataSourceType || 'complaint_ticket'),
  )
  if (!ticketLike.length) return 0
  const hit = ticketLike.filter(recordHasNonGenericOptimization).length
  return hit / ticketLike.length
}

/**
 * P0 验收：估算 LLM 调用次数（不含 sentiment / shared dimensions）。
 * @param {Object} params
 * @param {number} params.records
 * @param {'unified' | 'separate'} [params.ticketLlmMode]
 * @param {'ticket_first' | 'legacy'} [params.pipelineOrder]
 * @param {number} [params.journeyGatingSkipRate] 0~1，hybrid 下跳过旅程 LLM 的比例
 * @param {number} [params.optimizationRetryRate] unified 下需 compact 补打 optimization 的比例
 */
export function estimateTicketLlmCalls({
  records,
  ticketLlmMode = 'unified',
  pipelineOrder = 'ticket_first',
  journeyGatingSkipRate = 0,
  optimizationRetryRate = 0,
}) {
  const n = Math.max(0, records)
  const ticketPerRecord = ticketLlmMode === 'unified' ? 1 + optimizationRetryRate : 3
  const ticketCalls = n * ticketPerRecord
  const journeyCalls = n * Math.max(0, 1 - journeyGatingSkipRate)
  if (pipelineOrder === 'ticket_first') {
    return { ticketCalls, journeyCalls, total: ticketCalls + journeyCalls }
  }
  return { ticketCalls, journeyCalls, total: journeyCalls + ticketCalls }
}

/**
 * @param {number} baselineTotal
 * @param {number} optimizedTotal
 */
export function llmCallReductionRatio(baselineTotal, optimizedTotal) {
  if (baselineTotal <= 0) return 0
  return (baselineTotal - optimizedTotal) / baselineTotal
}

/**
 * @param {number} actual
 * @param {number} baseline
 * @param {number} [minRatio=GOLDEN_OPTIMIZATION_RATE_RATIO_MIN]
 */
export function meetsOptimizationGoldenRatio(actual, baseline, minRatio = GOLDEN_OPTIMIZATION_RATE_RATIO_MIN) {
  if (baseline <= 0) return actual >= 0
  return actual >= baseline * minRatio
}
