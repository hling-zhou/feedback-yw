/**
 * @param {{
 *   profile?: {
 *     primaryThresholdBase?: number
 *     secondaryThresholdBase?: number
 *   }
 *   records?: Array<{ normalizedPainText?: { qualityScore?: number } }>
 *   stage?: 'primary' | 'secondary'
 * }} input
 */
export function resolveClusterThresholds(input = {}) {
  const base =
    input.stage === 'secondary'
      ? input.profile?.secondaryThresholdBase ?? 0.2
      : input.profile?.primaryThresholdBase ?? 0.3
  const rows = input.records || []
  if (!rows.length) {
    return {
      threshold: base,
      minSharedTokens: 1,
    }
  }

  const avgQuality =
    rows.reduce((sum, row) => sum + (row?.normalizedPainText?.qualityScore || 0), 0) / rows.length
  const repeatRatio = Math.min(1, rows.length / 60)
  const qualityAdjustment = avgQuality < 0.45 ? 0.03 : avgQuality > 0.75 ? -0.02 : 0
  const repeatAdjustment = repeatRatio > 0.7 ? -0.02 : repeatRatio < 0.2 ? 0.02 : 0
  const threshold = Math.max(0.12, Math.min(0.55, base + qualityAdjustment + repeatAdjustment))
  const minSharedTokens = rows.length > 120 ? 3 : rows.length > 40 ? 2 : 1

  return {
    threshold,
    minSharedTokens,
  }
}

