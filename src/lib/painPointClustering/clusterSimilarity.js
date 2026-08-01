import { buildNormalizedPainText } from './normalizeSemanticTokens.js'
import { jaccardSimilarity } from './textTokenize.js'

function structureScore(a, b) {
  let score = 0
  if (a?.product && b?.product && a.product === b.product) score += 0.35
  if (a?.problemType && b?.problemType && a.problemType === b.problemType) score += 0.35
  if (a?.journeyL1 && b?.journeyL1 && a.journeyL1 === b.journeyL1) score += 0.2
  if (a?.dataSourceType && b?.dataSourceType && a.dataSourceType === b.dataSourceType) score += 0.1
  return Math.min(1, score)
}

/**
 * @param {ReturnType<typeof buildNormalizedPainText> | string | null | undefined} input
 */
export function ensureNormalizedPainText(input) {
  if (!input) return buildNormalizedPainText('')
  if (typeof input === 'string') return buildNormalizedPainText(input)
  return input
}

/**
 * @param {ReturnType<typeof ensureNormalizedPainText> | string} a
 * @param {ReturnType<typeof ensureNormalizedPainText> | string} b
 * @param {{
 *   product?: string
 *   problemType?: string
 *   journeyL1?: string
 *   dataSourceType?: string
 *   profile?: { profileId?: string }
 * }} [context]
 */
export function computeClusterSimilarity(a, b, context = {}) {
  const left = ensureNormalizedPainText(a)
  const right = ensureNormalizedPainText(b)
  const lexical = jaccardSimilarity(left.lexicalTokens, right.lexicalTokens)
  const semantic = jaccardSimilarity(left.semanticTokens, right.semanticTokens)
  const structural = structureScore(context.left || context, context.right || context)
  const negationPenalty =
    left.hasNegation !== right.hasNegation && semantic > 0.2 ? 0.12 : 0
  const intentBonus =
    left.hasPositiveIntent && right.hasPositiveIntent && semantic > 0.18 ? 0.06 : 0

  const fallback = Math.max(lexical, semantic)
  const score =
    lexical * 0.45
    + semantic * 0.4
    + structural * 0.15
    + intentBonus
    - negationPenalty

  return Math.max(0, Math.min(1, score || fallback))
}

