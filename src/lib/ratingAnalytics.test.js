import { describe, expect, it } from 'vitest'
import { aggregateRatingByProduct, summarizeRatings } from './ratingAnalytics.js'

describe('ratingAnalytics', () => {
  it('summarizeRatings computes avg and thresholds', () => {
    const s = summarizeRatings([
      { ratingScore: 10 },
      { ratingScore: 8 },
      { ratingScore: 6 },
      {},
    ])
    expect(s.recordCount).toBe(4)
    expect(s.scoredCount).toBe(3)
    expect(s.avgScore).toBe(8)
    expect(s.below9Count).toBe(2)
    expect(s.below7Count).toBe(1)
  })

  it('aggregateRatingByProduct groups by productKey', () => {
    const rows = aggregateRatingByProduct([
      { productKey: 'a', product: '产品A', ratingScore: 10 },
      { productKey: 'a', product: '产品A', ratingScore: 8 },
      { productKey: 'b', product: '产品B', ratingScore: 9 },
    ])
    expect(rows).toHaveLength(2)
    expect(rows[0].name).toBe('产品A')
    expect(rows[0].avgScore).toBe(9)
  })
})
