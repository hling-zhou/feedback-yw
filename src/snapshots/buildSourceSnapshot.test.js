import { describe, it, expect } from 'vitest'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'
import { filterRecordsForScope } from './recordScope.js'
import { buildPeriodSpec } from '../domain/insightPeriod.js'

describe('buildSourceSnapshot', () => {
  const periodMay = buildPeriodSpec({ granularity: 'month', year: 2025, month: 5 })
  const periodJun = buildPeriodSpec({ granularity: 'month', year: 2025, month: 6 })

  const records = [
    {
      id: '1',
      dataSourceType: 'complaint_ticket',
      rawText: 'test',
      customerQuote: 'quote',
      problemType: '计费与账单',
      complaintCauseL1Final: '服务不可用',
      journeyL1: '购买',
      journeyL2: '下单',
      problemSummary: '',
      solutionSummary: '',
      rootCause: '',
      optimizationSuggestion: '',
      sentiment: 'negative',
      themes: ['下单'],
      status: 'open',
      importedAt: '2025-05-01',
      importMonth: '2025-05',
    },
    {
      id: '2',
      dataSourceType: 'complaint_ticket',
      importMonth: '2025-06',
      importedAt: '2025-06-01',
      rawText: 'june',
      customerQuote: 'q',
      problemType: '计费与账单',
      complaintCauseL1Final: '服务不可用',
      journeyL1: '购买',
      journeyL2: '下单',
      problemSummary: '',
      solutionSummary: '',
      rootCause: '',
      optimizationSuggestion: '',
      sentiment: 'neutral',
      themes: [],
      status: 'open',
    },
  ]

  it('builds snapshot with summary and recordIds', () => {
    const scoped = filterRecordsForScope(records, periodMay, 'complaint_ticket')
    const snap = buildSourceSnapshot({
      insightPeriodId: 'p-may',
      dataSourceType: 'complaint_ticket',
      records: scoped,
    })
    expect(snap.summary.recordCount).toBe(1)
    expect(snap.recordIds).toEqual(['1'])
    expect(snap.aggregates.complaintCauseL1).toEqual([{ name: '服务不可用', count: 1 }])
    expect(snap.aggregates.problemTypes).toEqual([{ name: '计费与账单', count: 1 }])
    expect(snap.aggregates.painPointClustering?.clusteringVersion).toBe('v2.0')
    expect(snap.aggregates.painPointClustering?.products).toEqual({})
  })

  it('stores primary pain point clusters for ticket sources', () => {
    const pain = '账单金额计算错误导致多扣费用无法退订'
    const clustered = [
      {
        id: '1',
        dataSourceType: 'complaint_ticket',
        product: '弹性公网 IP',
        painPoint: pain,
        importMonth: '2025-05',
        importedAt: '2025-05-01',
        rawText: 'test',
        customerQuote: 'quote',
        problemType: '计费与账单',
        journeyL1: '购买',
        journeyL2: '下单',
        problemSummary: pain,
        solutionSummary: '',
        rootCause: '',
        optimizationSuggestion: '',
        sentiment: 'negative',
        themes: ['下单'],
        status: 'open',
      },
      {
        id: '2',
        dataSourceType: 'complaint_ticket',
        product: '弹性公网 IP',
        painPoint: pain,
        importMonth: '2025-05',
        importedAt: '2025-05-01',
        rawText: 'test2',
        customerQuote: 'quote2',
        problemType: '计费与账单',
        journeyL1: '购买',
        journeyL2: '下单',
        problemSummary: pain,
        solutionSummary: '',
        rootCause: '',
        optimizationSuggestion: '',
        sentiment: 'negative',
        themes: ['下单'],
        status: 'open',
      },
    ]
    const scoped = filterRecordsForScope(clustered, periodMay, 'complaint_ticket')
    const snap = buildSourceSnapshot({
      insightPeriodId: 'p-may',
      dataSourceType: 'complaint_ticket',
      records: scoped,
    })
    expect(snap.aggregates.painPointClustering?.clusteringVersion).toBe('v2.0')
    expect(snap.aggregates.painPointClustering?.products['弹性公网 IP']?.primaryClusters.length).toBeGreaterThanOrEqual(1)
  })

  it('filterRecordsForScope uses data time not period id', () => {
    const may = filterRecordsForScope(records, periodMay, 'complaint_ticket')
    const jun = filterRecordsForScope(records, periodJun, 'complaint_ticket')
    expect(may).toHaveLength(1)
    expect(jun).toHaveLength(1)
    expect(may[0].id).toBe('1')
    expect(jun[0].id).toBe('2')
  })

  it('embeds followUpSatisfactionMetrics on post_use_rating snapshot from ticket enrichments', () => {
    const ticketRecords = [
      {
        id: 't-fu-1',
        dataSourceType: 'complaint_ticket',
        importMonth: '2025-05',
        product: '云主机',
        requestScene: '报障',
        problemType: '故障',
        followUpSatisfaction: {
          followUpTicketId: 'FH-1',
          followUpSuccessful: true,
          score: 10,
          problemResolved: 'resolved',
          importMonth: '2025-05',
        },
      },
    ]
    const snap = buildSourceSnapshot({
      insightPeriodId: 'p-may',
      dataSourceType: 'post_use_rating',
      records: [],
      ticketRecordsForFollowUp: ticketRecords,
    })
    expect(snap.aggregates.followUpSatisfactionMetrics?.scoredCount).toBe(1)
    expect(snap.aggregates.followUpSatisfactionMetrics?.tenPointRateByMonth).toEqual([
      { month: '2025-05', tenCount: 1, total: 1, rate: 1 },
    ])
  })

  it('does not embed followUpSatisfactionMetrics on complaint_ticket snapshot', () => {
    const scoped = filterRecordsForScope(records, periodMay, 'complaint_ticket')
    const snap = buildSourceSnapshot({
      insightPeriodId: 'p-may',
      dataSourceType: 'complaint_ticket',
      records: scoped,
      ticketRecordsForFollowUp: scoped,
    })
    expect(snap.aggregates.followUpSatisfactionMetrics).toBeUndefined()
  })
})
