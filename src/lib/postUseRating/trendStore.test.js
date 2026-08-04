import { describe, expect, it } from 'vitest'
import {
  mergeHistoricalTrendSeed,
  emptyPostUseTrend,
  buildFocusScoreTrendChartModel,
  POST_USE_TREND_HISTORICAL_SEED,
  loadPostUseTrend,
  stripHistoricalSeedRows,
} from './trendStore.js'
import { aggregateOptionReasons } from './reasonStats.js'

describe('trendStore historical seed', () => {
  it('merges focus product scores without wiping empty snap', () => {
    const next = mergeHistoricalTrendSeed(emptyPostUseTrend())
    expect(next.seededFromHistorical).toBe(true)
    expect(next.scores.length).toBeGreaterThan(20)
    const yx = next.scores.find(
      (r) => r.productName === '云专线' && r.month === '2026-01' && r.scope === 'internal_experience',
    )
    expect(yx?.avgScore).toBe(9.42)
    expect(POST_USE_TREND_HISTORICAL_SEED.months).toEqual([
      '2026-01',
      '2026-02',
      '2026-03',
      '2026-04',
      '2026-05',
    ])
  })

  it('does not overwrite existing month product score', () => {
    const base = emptyPostUseTrend()
    base.scores.push({
      month: '2026-01',
      productName: '云专线',
      avgScore: 1.11,
      sampleSize: 9,
      scope: 'internal_experience',
    })
    const next = mergeHistoricalTrendSeed(base)
    const yx = next.scores.find(
      (r) => r.productName === '云专线' && r.month === '2026-01' && r.scope === 'internal_experience',
    )
    expect(yx?.avgScore).toBe(1.11)
  })

  it('builds chart model for focus names', () => {
    const snap = mergeHistoricalTrendSeed(emptyPostUseTrend())
    const { data, areas } = buildFocusScoreTrendChartModel(snap, ['云专线', '共享带宽'])
    expect(areas).toHaveLength(2)
    expect(data[0].date).toBe('2026-01')
    expect(data[0]['云专线']).toBe(9.42)
  })

  it('keeps historical seed rows visible for online display', () => {
    const snap = mergeHistoricalTrendSeed(emptyPostUseTrend())
    const stripped = stripHistoricalSeedRows(snap)
    expect(stripped.scores.length).toBe(snap.scores.length)
    expect(stripped.satisfaction.length).toBe(snap.satisfaction.length)
    expect(stripped.seededFromHistorical).toBe(true)
  })

  it('loadPostUseTrend merges built-in historical rows with stored trend rows', async () => {
    const adapter = {
      getMeta: async () => ({
        version: 1,
        updatedAt: '2026-08-04T00:00:00.000Z',
        scores: [
          {
            month: '2026-06',
            productName: '云专线',
            avgScore: 9.5,
            sampleSize: 12,
            scope: 'internal_experience',
          },
        ],
        satisfaction: [
          {
            month: '2026-06',
            productName: '云专线',
            rate: 90,
            sampleSize: 12,
          },
        ],
      }),
    }
    const merged = await loadPostUseTrend(adapter)
    expect(merged.scores).toContainEqual(
      expect.objectContaining({ month: '2026-01', productName: '云专线', avgScore: 9.42 }),
    )
    expect(merged.scores).toContainEqual(
      expect.objectContaining({ month: '2026-06', productName: '云专线', avgScore: 9.5 }),
    )
    expect(merged.satisfaction).toContainEqual(
      expect.objectContaining({ month: '2026-05', productName: '共享带宽', rate: 100 }),
    )
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
