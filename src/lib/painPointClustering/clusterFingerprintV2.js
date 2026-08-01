import { buildStableHashKey } from '../planningRecommendations.js'
import { buildNormalizedPainText } from './normalizeSemanticTokens.js'

export const CLUSTER_FINGERPRINT_V2 = 'cluster-fingerprint-v2'

/**
 * @param {{
 *   product?: string
 *   theme?: string
 *   problemType?: string
 *   journeyL1?: string
 *   tokens?: string[]
 * }} input
 */
export function buildClusterFingerprintV2(input) {
  const normalized = buildNormalizedPainText(input.theme || '')
  return buildStableHashKey('pcf2', [
    'cluster-fingerprint-v2',
    input.product,
    normalized.canonicalText,
    input.problemType,
    input.journeyL1,
    ...(input.tokens?.length ? input.tokens : normalized.keyTokens.slice(0, 6)),
  ])
}

