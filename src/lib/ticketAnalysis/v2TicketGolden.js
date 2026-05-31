import { CUSTOMER_REQUEST_HARD_MAX } from './customerRequestExtract.js'
import { PAIN_POINT_HARD_MAX } from './painPointExtract.js'
import { textJaccardSimilarity } from './ticketLlmGolden.js'

/** V2 规范 LLM golden Jaccard 阈值（与 U-06 一致） */
export const V2_GOLDEN_JACCARD_MIN = 0.85

const LEADING_PHRASE_RE =
  /^(?:用户(?:希望|建议|反馈|要求|反映|咨询)|客户(?:希望|建议|反馈|要求|反映))/

/**
 * @param {string} actual
 * @param {{ ruleMustInclude: string[]; ruleMustExclude?: string[] }} spec
 */
export function assertRuleLayerCustomerRequest(actual, spec) {
  const text = (actual || '').trim()
  if (!text) throw new Error('rule customerRequest empty')
  if (text.length > CUSTOMER_REQUEST_HARD_MAX) {
    throw new Error(`rule customerRequest exceeds ${CUSTOMER_REQUEST_HARD_MAX} chars`)
  }
  for (const kw of spec.ruleMustInclude) {
    if (!text.includes(kw)) {
      throw new Error(`rule customerRequest missing keyword: ${kw}`)
    }
  }
  for (const bad of spec.ruleMustExclude ?? []) {
    if (text.includes(bad)) {
      throw new Error(`rule customerRequest must not include: ${bad}`)
    }
  }
}

/**
 * @param {string} actual
 * @param {{ ruleMustInclude: string[]; ruleMustExclude?: string[] }} spec
 */
export function assertRuleLayerPainPoint(actual, spec) {
  const text = (actual || '').trim()
  if (!text) throw new Error('rule painPoint empty')
  if (text.length > PAIN_POINT_HARD_MAX) {
    throw new Error(`rule painPoint exceeds ${PAIN_POINT_HARD_MAX} chars`)
  }
  if (LEADING_PHRASE_RE.test(text)) {
    throw new Error('rule painPoint must not start with leading phrase')
  }
  for (const kw of spec.ruleMustInclude) {
    if (!text.includes(kw)) {
      throw new Error(`rule painPoint missing keyword: ${kw}`)
    }
  }
  for (const bad of spec.ruleMustExclude ?? []) {
    if (text.includes(bad)) {
      throw new Error(`rule painPoint must not include: ${bad}`)
    }
  }
}

/**
 * @param {string} actual
 * @param {string} expected
 * @param {number} [min=V2_GOLDEN_JACCARD_MIN]
 */
export function assertLlmGoldenSimilarity(actual, expected, min = V2_GOLDEN_JACCARD_MIN) {
  const score = textJaccardSimilarity(actual || '', expected || '')
  if (score < min) {
    throw new Error(
      `Jaccard ${score.toFixed(3)} < ${min}: actual="${actual}" expected="${expected}"`,
    )
  }
  return score
}
