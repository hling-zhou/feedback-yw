import { describe, expect, it } from 'vitest'
import {
  buildMonthlyScoreTable,
  computeExternalMixedMetrics,
  computeInternalSatisfactionMetrics,
  computeScoreDistribution,
} from './metrics.js'

describe('internal callback satisfaction summary', () => {
  it('computes overall sample size and ten-point rate from callback rows', () => {
    const result = computeInternalSatisfactionMetrics(
      [
        { channel: 'callback', productName: 'A', score: 10 },
        { channel: 'callback', productName: 'A', score: 9 },
        { channel: 'callback', productName: 'B', score: 10 },
        { channel: 'sms', productName: 'A', score: 10 },
        { channel: 'callback', productName: '未启用', score: 10 },
      ],
      { productNames: ['A', 'B'] },
    )

    expect(result.totalSample).toBe(3)
    expect(result.tenCount).toBe(2)
    expect(result.rate).toBe(66.67)
  })

  it('builds monthly score table with mixed score and callback metrics', () => {
    const rows = buildMonthlyScoreTable(
      [
        { channel: 'sms', productName: 'A', score: 10 },
        { channel: 'console', productName: 'A', score: 8 },
        { channel: 'callback', productName: 'A', score: 10 },
        { channel: 'callback', productName: 'A', score: 9 },
        { channel: 'sms', productName: 'B', score: 10 },
      ],
      { productNames: ['A', 'B'] },
    )

    expect(rows).toEqual([
      expect.objectContaining({
        productName: 'A',
        sampleSize: 4,
        avgScore: 9.25,
        callbackTenPointRate: 50,
        callbackSampleSize: 2,
        hasCallbackSamples: true,
        hasNonTenScore: true,
        scoreChannels: ['sms', 'console', 'callback'],
      }),
      expect.objectContaining({
        productName: 'B',
        sampleSize: 1,
        avgScore: 10,
        callbackTenPointRate: null,
        callbackSampleSize: 0,
        hasCallbackSamples: false,
        hasNonTenScore: false,
        scoreChannels: ['sms'],
      }),
    ])
  })

  it('computes score distribution buckets by product', () => {
    const result = computeScoreDistribution(
      [
        { productName: 'A', score: 10 },
        { productName: 'A', score: 9.4 },
        { productName: 'A', score: 1.2 },
        { productName: 'B', score: 7 },
      ],
      ['A'],
    )

    expect(result.A).toEqual({
      sampleSize: 3,
      10: 1,
      9: 1,
      8: 0,
      7: 0,
      6: 0,
      5: 0,
      4: 0,
      3: 0,
      2: 0,
      1: 1,
    })
    expect(result.B).toBeUndefined()
  })
})

describe('external mixed company vs yunwang scope', () => {
  it('keeps yunwang on scoredRows and company on companyRows', () => {
    const yunwangRows = [
      { channel: 'sms', productName: '弹性公网IP', score: 10 },
      { channel: 'console', productName: '弹性公网IP', score: 8 },
      { channel: 'callback', productName: '弹性公网IP', score: 10 },
    ]
    const companyRows = [
      ...yunwangRows,
      { channel: 'sms', productName: '云主机 ECS', score: 10 },
      { channel: 'console', productName: '工单', score: 6 },
    ]
    const result = computeExternalMixedMetrics(yunwangRows, {
      productNames: ['弹性公网IP'],
      companyRows,
    })

    expect(result.yunwang.productCount).toBe(1)
    expect(result.yunwang.totalSample).toBe(3)
    expect(result.yunwang.avgScore).toBe(9.33)
    expect(result.company.totalSample).toBe(5)
    expect(result.company.avgScore).toBe(8.8)
    expect(result.company.productCount).toBe(3)
  })

  it('merges sub-products before counting company products', () => {
    const rows = [
      { channel: 'sms', productName: '云电脑（办公型）', score: 10 },
      { channel: 'console', productName: '云电脑（信创型）', score: 8 },
      { channel: 'sms', productName: '无/不涉及', score: 9 },
    ]
    const result = computeExternalMixedMetrics(rows, { productNames: ['弹性公网IP'] })

    expect(result.yunwang.totalSample).toBe(0)
    expect(result.company.productCount).toBe(2)
    expect(result.company.totalSample).toBe(3)
    expect(result.company.avgScore).toBe(9)
    expect(result.company.byProduct.map((p) => p.productName)).toEqual(
      expect.arrayContaining(['云电脑', '无/不涉及']),
    )
  })
})
