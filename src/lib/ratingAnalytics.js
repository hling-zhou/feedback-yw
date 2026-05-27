/**
 * @param {import('./types.js').FeedbackRecord[]} items
 */
export function aggregateRatingByProduct(items) {
  /** @type {Map<string, { productKey: string; name: string; count: number; scores: number[] }>} */
  const map = new Map()

  for (const fb of items) {
    const productKey = fb.productKey || fb.product || 'unknown'
    const name = fb.product?.trim() || fb.productSpec?.trim() || productKey
    if (!map.has(productKey)) {
      map.set(productKey, { productKey, name, count: 0, scores: [] })
    }
    const entry = map.get(productKey)
    entry.count += 1
    const score = fb.ratingScore != null ? Number(fb.ratingScore) : NaN
    if (Number.isFinite(score)) entry.scores.push(score)
  }

  return [...map.values()]
    .map((e) => ({
      productKey: e.productKey,
      name: e.name,
      count: e.count,
      avgScore:
        e.scores.length > 0
          ? Math.round((e.scores.reduce((a, b) => a + b, 0) / e.scores.length) * 100) / 100
          : null,
      lowScoreCount: e.scores.filter((s) => s < 9).length,
    }))
    .sort((a, b) => b.count - a.count)
}

/**
 * @param {import('./types.js').FeedbackRecord[]} items
 */
export function summarizeRatings(items) {
  const scores = items
    .map((fb) => (fb.ratingScore != null ? Number(fb.ratingScore) : NaN))
    .filter((s) => Number.isFinite(s))

  const avgScore =
    scores.length > 0
      ? Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 100) / 100
      : null

  return {
    recordCount: items.length,
    scoredCount: scores.length,
    avgScore,
    below9Count: scores.filter((s) => s < 9).length,
    below7Count: scores.filter((s) => s < 7).length,
  }
}
