import { normalizeClusteringPainText } from './clusteringCorpus.js'
import { maskPainEntities } from './entityMasking.js'
import { NEGATION_PATTERNS, POSITIVE_INTENT_PATTERNS } from './negationRules.js'
import { SEMANTIC_CANONICAL_TOKENS, SEMANTIC_SYNONYM_RULES } from './synonymDictionary.js'
import { tokenizePainPointText } from './textTokenize.js'

function applySemanticReplacements(text) {
  let normalized = String(text || '')
  for (const [from, to] of SEMANTIC_SYNONYM_RULES) {
    normalized = normalized.replaceAll(from, to)
  }
  return normalized
}

/**
 * @param {string} text
 * @returns {{
 *   rawText: string
 *   cleanedText: string
 *   maskedText: string
 *   canonicalText: string
 *   lexicalTokens: Set<string>
 *   semanticTokens: Set<string>
 *   keyTokens: string[]
 *   hasNegation: boolean
 *   hasPositiveIntent: boolean
 *   qualityScore: number
 * }}
 */
export function buildNormalizedPainText(text) {
  const rawText = String(text || '').trim()
  const cleanedText = normalizeClusteringPainText(rawText) || rawText
  const maskedText = maskPainEntities(cleanedText)
  const canonicalText = applySemanticReplacements(maskedText)
  const lexicalTokens = new Set(tokenizePainPointText(maskedText))
  const semanticTokens = new Set(
    tokenizePainPointText(canonicalText).map((token) => SEMANTIC_CANONICAL_TOKENS.get(token) || token),
  )
  const keyTokens = [...semanticTokens].slice(0, 8)
  const hasNegation = NEGATION_PATTERNS.some((pattern) => pattern.test(canonicalText))
  const hasPositiveIntent = POSITIVE_INTENT_PATTERNS.some((pattern) => pattern.test(canonicalText))
  const qualityScore = Math.min(
    1,
    (canonicalText.length >= 8 ? 0.4 : 0.2)
      + Math.min(semanticTokens.size, 6) * 0.1
      + (hasNegation || hasPositiveIntent ? 0.1 : 0),
  )

  return {
    rawText,
    cleanedText,
    maskedText,
    canonicalText,
    lexicalTokens,
    semanticTokens,
    keyTokens,
    hasNegation,
    hasPositiveIntent,
    qualityScore,
  }
}

