import { describe, expect, it } from 'vitest'
import {
  mergeHistoricalTrendSeed,
  emptyPostUseTrend,
  buildFocusScoreTrendChartModel,
  POST_USE_TREND_HISTORICAL_SEED,
} from './trendStore.js'
import { aggregateOptionReasons } from './reasonStats.js'

describe('trendStore historical seed', () => {
  it('merges focus product scores without wiping empty snap', () => {
    const next = mergeHistoricalTrendSeed(emptyPostUseTrend())
    expect(next.seededFromHistorical).toBe(true)
    expect(next.scores.length).toBeGreaterThan(20)
    const yx = next.scores.find(
      (r) => r.productName === '云专线' && r.month === '2025-09' && r.scope === 'internal_experience',
    )
    expect(yx?.avgScore).toBe(9.71)
    expect(POST_USE_TREND_HISTORICAL_SEED.months).toContain('2026-06')
  })

  it('does not overwrite existing month product score', () => {
    const base = emptyPostUseTrend()
    base.scores.push({
      month: '2025-09',
      productName: '云专线',
      avgScore: 1.11,
      sampleSize: 9,
      scope: 'internal_experience',
    })
    const next = mergeHistoricalTrendSeed(base)
    const yx = next.scores.find(
      (r) => r.productName === '云专线' && r.month === '2025-09' && r.scope === 'internal_experience',
    )
    expect(yx?.avgScore).toBe(1.11)
  })

  it('builds chart model for focus names', () => {
    const snap = mergeHistoricalTrendSeed(emptyPostUseTrend())
    const { data, areas } = buildFocusScoreTrendChartModel(snap, ['云专线', '共享带宽'])
    expect(areas).toHaveLength(2)
    expect(data[0].date).toBe('2025-09')
    expect(data[0]['云专线']).toBe(9.71)
  })
})

describe('aggregateOptionReasons', () => {
  it('counts and excludes 其他/业务使用完毕', () => {
    const rows = [
      { rawComment: '价格贵', productName: '弹性公网IP' },
      { rawComment: '价格贵', productName: '弹性公网IP' },
      { rawComment: '其他', productName: '云专线' },
      { rawComment: '业务使用完毕', productName: '共享带宽' },
      { lowScoreReason: '开通慢', productName: '虚拟私有云' },
    ]
    const agg = aggregateOptionReasons(rows)
    expect(agg.find((r) => r.reason === '价格贵')?.count).toBe(2)
    expect(agg.find((r) => r.reason === '开通慢')?.count).toBe(1)
    expect(agg.find((r) => r.reason === '其他')).toBeUndefined()
  })
})
