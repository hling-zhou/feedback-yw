import { describe, expect, it } from 'vitest'
import { randomId } from './randomId.js'
import {
  attachRecommendationPeriodCompare,
  recommendationCompareKey,
  summarizeRecommendationPeriodCompare,
} from './planningRecommendationCompare.js'

function rec(overrides = {}) {
  return {
    id: randomId(),
    priority: 'medium',
    category: 'product',
    text: 'x',
    summary: 'x',
    signalType: 'journey_hotspot',
    scope: { product: 'ECS', journeyL2: '公网访问不通' },
    ...overrides,
  }
}

describe('planningRecommendationCompare', () => {
  it('recommendationCompareKey is stable for same axis', () => {
    const a = rec()
    const b = rec({ id: randomId(), summary: 'other' })
    expect(recommendationCompareKey(a)).toBe(recommendationCompareKey(b))
  })

  it('attachRecommendationPeriodCompare marks new and priority changes', () => {
    const previous = [
      rec({
        id: 'old-1',
        priority: 'low',
        scope: { product: 'ECS', journeyL2: '公网访问不通' },
      }),
    ]
    const current = [
      rec({
        id: 'new-1',
        priority: 'high',
        scope: { product: 'SLB', journeyL2: '绑定失败' },
      }),
      rec({
        id: 'old-2',
        priority: 'high',
        scope: { product: 'ECS', journeyL2: '公网访问不通' },
      }),
    ]
    const { recommendations, removedFromPreviousCount } = attachRecommendationPeriodCompare(
      current,
      previous,
    )
    expect(recommendations[0].periodCompare?.change).toBe('new')
    expect(recommendations[1].periodCompare?.change).toBe('priority_up')
    expect(removedFromPreviousCount).toBe(0)
    const summary = summarizeRecommendationPeriodCompare(recommendations)
    expect(summary.new).toBe(1)
    expect(summary.priority_up).toBe(1)
  })

  it('prefers stableKey when present', () => {
    const previous = [
      rec({
        id: 'old-1',
        stableKey: 'pcl-aaaa',
        priority: 'low',
        scope: { product: 'ECS', journeyL2: '公网访问不通' },
      }),
    ]
    const current = [
      rec({
        id: 'new-2',
        stableKey: 'pcl-aaaa',
        priority: 'medium',
        summary: '完全改写后的摘要',
        scope: { product: 'ECS', journeyL2: '另一个旅程轴' },
      }),
    ]
    const { recommendations, removedFromPreviousCount } = attachRecommendationPeriodCompare(
      current,
      previous,
    )
    expect(recommendations[0].periodCompare?.change).toBe('priority_up')
    expect(recommendations[0].periodCompare?.previousId).toBe('old-1')
    expect(removedFromPreviousCount).toBe(0)
  })
})
