import { describe, expect, it } from 'vitest'
import {
  TEN_POINT_SATISFACTION_BASELINE,
  buildFollowUpSatisfactionMetrics,
  buildTenPointRateTrendChart,
  computeDissatisfiedReasonDistribution,
  computeDissatisfiedReasonValueWordCloud,
  computeNonTenProblemTypeDistribution,
  computeScoreDistributionByProduct,
  computeTenPointRateByMonth,
  computeUnresolvedStats,
  filterFollowUpScoredRecords,
  formatFollowUpMonthLabel,
  resolveFollowUpSatisfactionMetrics,
} from './followUpSatisfactionAnalytics.js'

/**
 * @param {Partial<import('./types.js').FeedbackRecord>} overrides
 */
function ticket(overrides = {}) {
  return {
    id: 't1',
    dataSourceType: 'complaint_ticket',
    importMonth: '2026-05',
    product: '云主机',
    requestScene: '报障',
    problemType: '故障',
    ...overrides,
  }
}

describe('followUpSatisfactionAnalytics', () => {
  const fixtures = [
    ticket({
      id: 'a',
      followUpSatisfaction: {
        followUpTicketId: 'FH-1',
        followUpSuccessful: true,
        score: 10,
        problemResolved: 'resolved',
        importMonth: '2026-05',
      },
    }),
    ticket({
      id: 'b',
      product: '云主机',
      followUpSatisfaction: {
        followUpTicketId: 'FH-2',
        followUpSuccessful: true,
        score: 8,
        problemResolved: 'unresolved',
        importMonth: '2026-05',
        dissatisfiedReasonParts: { overallService: '响应慢' },
      },
    }),
    ticket({
      id: 'c',
      product: 'VPC',
      importMonth: '2026-04',
      followUpSatisfaction: {
        followUpTicketId: 'FH-3',
        followUpSuccessful: true,
        score: 10,
        problemResolved: 'resolved',
        importMonth: '2026-04',
      },
    }),
    ticket({
      id: 'd',
      dataSourceType: 'post_use_rating',
      followUpSatisfaction: {
        followUpTicketId: 'FH-x',
        followUpSuccessful: true,
        score: 10,
      },
    }),
    ticket({
      id: 'e',
      followUpSatisfaction: {
        followUpTicketId: 'FH-4',
        followUpSuccessful: false,
        score: 10,
      },
    }),
  ]

  it('filterFollowUpScoredRecords includes complaint/consultation with successful scored follow-up only', () => {
    expect(filterFollowUpScoredRecords(fixtures)).toHaveLength(3)
  })

  it('computeTenPointRateByMonth buckets by follow-up importMonth with correct rate', () => {
    const rows = computeTenPointRateByMonth(fixtures)
    expect(rows).toEqual([
      { month: '2026-04', tenCount: 1, total: 1, rate: 1 },
      { month: '2026-05', tenCount: 1, total: 2, rate: 0.5 },
    ])
  })

  it('computeTenPointRateByMonth filters by productKey', () => {
    const rows = computeTenPointRateByMonth(fixtures, '云主机')
    expect(rows).toEqual([{ month: '2026-05', tenCount: 1, total: 2, rate: 0.5 }])
  })

  it('computeScoreDistributionByProduct counts non-ten scores and lowScoreCount', () => {
    const rows = computeScoreDistributionByProduct([
      ...fixtures,
      ticket({
        id: 'f',
        product: '云主机',
        followUpSatisfaction: {
          followUpTicketId: 'FH-5',
          followUpSuccessful: true,
          score: 4,
          importMonth: '2026-05',
        },
      }),
    ])
    const host = rows.find((r) => r.productKey === '云主机')
    expect(host?.scores['8']).toBe(1)
    expect(host?.scores['4']).toBe(1)
    expect(host?.lowScoreCount).toBe(1)
    expect(host?.nonTenTotal).toBe(2)
  })

  it('computeNonTenProblemTypeDistribution only counts non-10 scores', () => {
    expect(computeNonTenProblemTypeDistribution(fixtures)).toEqual([
      { name: '故障', count: 1 },
    ])
  })

  it('computeDissatisfiedReasonDistribution counts reason dimensions on non-10 subset', () => {
    const rows = computeDissatisfiedReasonDistribution(fixtures)
    expect(rows).toEqual([
      expect.objectContaining({ reasonDim: 'overallService', count: 1 }),
    ])
    expect(rows.find((r) => r.reasonDim === 'staffAttitudeScore')).toBeUndefined()
  })

  it('computeDissatisfiedReasonValueWordCloud aggregates reason texts and filters placeholders', () => {
    const rows = computeDissatisfiedReasonValueWordCloud([
      ...fixtures,
      ticket({
        id: 'g',
        followUpSatisfaction: {
          followUpTicketId: 'FH-6',
          followUpSuccessful: true,
          score: 7,
          dissatisfiedReasonParts: {
            overallService: '响应慢',
            staffAttitudeReason: '态度一般',
            phoneCallbackOpinion: '无',
          },
        },
      }),
      ticket({
        id: 'h',
        followUpSatisfaction: {
          followUpTicketId: 'FH-7',
          followUpSuccessful: true,
          score: 6,
          dissatisfiedReasonParts: { overallService: '响应慢' },
        },
      }),
    ])
    expect(rows).toEqual([
      { word: '响应慢', count: 3 },
      { word: '态度一般', count: 1 },
    ])
  })

  it('buildFollowUpSatisfactionMetrics includes dissatisfiedReasonWords', () => {
    const metrics = buildFollowUpSatisfactionMetrics(fixtures)
    expect(metrics.dissatisfiedReasonWords).toEqual([{ word: '响应慢', count: 1 }])
  })

  it('computeUnresolvedStats counts unresolved among scored follow-ups', () => {
    expect(computeUnresolvedStats(fixtures)).toEqual({
      unresolvedCount: 1,
      totalScored: 3,
      unresolvedRate: 0.333,
    })
  })

  it('buildFollowUpSatisfactionMetrics assembles full payload', () => {
    const metrics = buildFollowUpSatisfactionMetrics(fixtures)
    expect(metrics.version).toBe(1)
    expect(metrics.scoredCount).toBe(3)
    expect(metrics.tenPointRateByMonth.length).toBe(2)
    expect(metrics.products).toHaveLength(2)
    expect(TEN_POINT_SATISFACTION_BASELINE).toBe(0.88)
  })

  it('resolveFollowUpSatisfactionMetrics prefers snapshot cache', () => {
    const cached = buildFollowUpSatisfactionMetrics(fixtures)
    const resolved = resolveFollowUpSatisfactionMetrics(
      { aggregates: { followUpSatisfactionMetrics: cached } },
      [],
    )
    expect(resolved).toBe(cached)
  })

  it('resolveFollowUpSatisfactionMetrics falls back to live records', () => {
    const resolved = resolveFollowUpSatisfactionMetrics(null, fixtures)
    expect(resolved.scoredCount).toBe(3)
  })

  it('formatFollowUpMonthLabel renders Chinese month label', () => {
    expect(formatFollowUpMonthLabel('2026-05')).toBe('2026年5月')
  })

  it('buildTenPointRateTrendChart builds multi-product line series as percentages', () => {
    const { chartData, lines } = buildTenPointRateTrendChart(fixtures)
    expect(lines).toHaveLength(2)
    expect(chartData).toEqual([
      expect.objectContaining({ date: '2026年4月', VPC: 100 }),
      expect.objectContaining({ date: '2026年5月', 云主机: 50 }),
    ])
  })

  it('buildTenPointRateTrendChart filters to one product', () => {
    const { lines, chartData } = buildTenPointRateTrendChart(fixtures, 'VPC')
    expect(lines).toHaveLength(1)
    expect(lines[0].name).toBe('VPC')
    expect(chartData).toEqual([expect.objectContaining({ VPC: 100 })])
  })
})
