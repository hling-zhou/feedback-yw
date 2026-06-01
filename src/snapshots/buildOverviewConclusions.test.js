import { describe, it, expect } from 'vitest'
import { buildOverviewConclusions } from './buildOverviewConclusions.js'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'
import { createInsightPeriod } from '../domain/insightPeriod.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    source: '工单',
    rawText: 'test',
    createdAt: '2025-06-15T10:00:00Z',
    importMonth: '2025-06',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    problemType: '公网访问不通',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    rootCause: '安全组未放行导致无法访问',
    ...overrides,
  }
}

describe('buildOverviewConclusions', () => {
  it('returns insufficient data message when total records < 3', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    const conclusions = buildOverviewConclusions({
      period,
      feedbacks: [makeRecord()],
      sourceSnapshots: {},
      crossSourceMetrics: { totalRecords: 1 },
    })
    expect(conclusions.insufficientData).toBe(true)
    expect(conclusions.highlights).toHaveLength(0)
    expect(conclusions.executiveSummary).toBe('')
    expect(conclusions.recommendations).toHaveLength(0)
  })

  it('builds recommendations without period insight highlights', () => {
    const period = createInsightPeriod({
      label: '2025-06',
      granularity: 'month',
      anchorYear: 2025,
      anchorMonth: 6,
    })
    const records = [
      makeRecord(),
      makeRecord({ id: crypto.randomUUID() }),
      makeRecord({ id: crypto.randomUUID(), problemType: '公网访问不通' }),
      makeRecord({
        id: crypto.randomUUID(),
        dataSourceType: 'consultation_ticket',
        problemType: '计费与账单',
        journeyL1: '认知与选型',
        journeyL2: '产品与规格咨询',
      }),
    ]
    const complaintSnap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records: records.filter((r) => r.dataSourceType === 'complaint_ticket'),
    })
    const consultationSnap = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'consultation_ticket',
      records: records.filter((r) => r.dataSourceType === 'consultation_ticket'),
    })

    const conclusions = buildOverviewConclusions({
      period,
      feedbacks: records,
      sourceSnapshots: {
        complaint_ticket: complaintSnap,
        consultation_ticket: consultationSnap,
      },
      crossSourceMetrics: { totalRecords: records.length, monthly_trend: [{ date: '2025-05', count: 1 }, { date: '2025-06', count: 4 }] },
    })

    expect(conclusions.insufficientData).toBe(false)
    expect(conclusions.executiveSummary).toBe('')
    expect(conclusions.highlights).toHaveLength(0)
    expect(conclusions.recommendations.length).toBeGreaterThan(0)
    expect(conclusions.recommendationsMeta?.recommendationEngine).toBeDefined()
    const rec = conclusions.recommendations[0]
    expect(rec.summary || rec.text).toBeTruthy()
    expect(rec.details?.length || rec.sections?.painClusterScores || rec.sections?.productActions?.length).toBeTruthy()
    expect(conclusions.source).toBe('rule')
  })
})
