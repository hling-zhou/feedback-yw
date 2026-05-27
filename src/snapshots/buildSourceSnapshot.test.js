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
  })

  it('filterRecordsForScope uses data time not period id', () => {
    const may = filterRecordsForScope(records, periodMay, 'complaint_ticket')
    const jun = filterRecordsForScope(records, periodJun, 'complaint_ticket')
    expect(may).toHaveLength(1)
    expect(jun).toHaveLength(1)
    expect(may[0].id).toBe('1')
    expect(jun[0].id).toBe('2')
  })
})
