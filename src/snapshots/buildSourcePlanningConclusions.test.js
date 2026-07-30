import { describe, expect, it } from 'vitest'
import { buildSourcePlanningConclusions } from './buildSourcePlanningConclusions.js'
import { buildSourceSnapshot } from './buildSourceSnapshot.js'
import { buildPeriodSpec, insightPeriodFromSpec } from '../domain/insightPeriod.js'
import { SCHEMA_VERSION, DEFAULT_TENANT_ID } from '../domain/constants.js'

function makeTicket(overrides = {}) {
  const pain = overrides.painPoint || '账单金额计算错误导致多扣费用无法退订且反复投诉'
  return {
    id: overrides.id || 'r1',
    ticketId: overrides.ticketId || 'T-1',
    dataSourceType: overrides.dataSourceType || 'complaint_ticket',
    product: overrides.product || '弹性公网 IP',
    painPoint: pain,
    importMonth: '2025-05',
    importedAt: '2025-05-01',
    rawText: 'test',
    customerQuote: 'quote',
    problemType: '计费与账单',
    journeyL1: '购买',
    journeyL2: '下单',
    problemSummary: '',
    solutionSummary: '',
    rootCause: '',
    optimizationSuggestion: '',
    sentiment: 'negative',
    themes: [],
    status: 'open',
    ...overrides,
  }
}

describe('buildSourcePlanningConclusions', () => {
  const period = insightPeriodFromSpec(
    buildPeriodSpec({ granularity: 'month', year: 2025, month: 5 }),
    SCHEMA_VERSION,
    DEFAULT_TENANT_ID,
  )

  it('marks insufficientData when sample is tiny', () => {
    const conclusions = buildSourcePlanningConclusions({
      period,
      dataSourceType: 'complaint_ticket',
      records: [makeTicket({ id: 'a' }), makeTicket({ id: 'b', ticketId: 'T-2' })],
    })
    expect(conclusions.insufficientData).toBe(true)
    expect(conclusions.recommendations).toHaveLength(0)
    expect(conclusions.recommendationsMeta?.dataSourceType).toBeUndefined()
  })

  it('tags recommendationsMeta.dataSourceType for ticket source', () => {
    const records = Array.from({ length: 8 }, (_, i) =>
      makeTicket({
        id: `c${i}`,
        ticketId: `TC-${i}`,
        dataSourceType: 'consultation_ticket',
        painPoint: `咨询侧网络连通故障反复出现无法恢复${i}`,
      }),
    )
    const conclusions = buildSourcePlanningConclusions({
      period,
      dataSourceType: 'consultation_ticket',
      records,
    })
    expect(conclusions.insufficientData).toBe(false)
    expect(conclusions.recommendationsMeta?.dataSourceType).toBe('consultation_ticket')
  })
})

describe('buildSourceSnapshot planningConclusions', () => {
  it('writes planningConclusions only for ticket sources', () => {
    const period = insightPeriodFromSpec(
      buildPeriodSpec({ granularity: 'month', year: 2025, month: 5 }),
      SCHEMA_VERSION,
      DEFAULT_TENANT_ID,
    )
    const complaint = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'complaint_ticket',
      records: Array.from({ length: 5 }, (_, i) =>
        makeTicket({ id: `p${i}`, ticketId: `P-${i}` }),
      ),
      period,
    })
    expect(complaint.aggregates.planningConclusions).toBeTruthy()
    expect(complaint.aggregates.planningConclusions.recommendationsMeta?.dataSourceType).toBe(
      'complaint_ticket',
    )

    const rating = buildSourceSnapshot({
      insightPeriodId: period.id,
      dataSourceType: 'post_use_rating',
      records: [],
      period,
    })
    expect(rating.aggregates.planningConclusions).toBeUndefined()
  })
})
