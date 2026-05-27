import { describe, expect, it } from 'vitest'
import { filterRecordsForScope } from '../snapshots/recordScope.js'
import { buildPeriodSpec, insightPeriodFromSpec } from '../domain/insightPeriod.js'
import { SCHEMA_VERSION } from '../domain/constants.js'

describe('usePeriodScope / filterRecordsForScope', () => {
  const may = insightPeriodFromSpec(
    buildPeriodSpec({ granularity: 'month', year: 2025, month: 5 }),
    SCHEMA_VERSION,
  )

  const records = [
    { id: '1', importMonth: '2025-05', dataSourceType: 'complaint_ticket' },
    { id: '2', importMonth: '2025-04', dataSourceType: 'complaint_ticket' },
    { id: '3', importMonth: '2025-05', dataSourceType: 'user_survey' },
  ]

  it('filters by period data time', () => {
    const scoped = filterRecordsForScope(records, may)
    expect(scoped.map((r) => r.id)).toEqual(['1', '3'])
  })

  it('filters by period and source', () => {
    const scoped = filterRecordsForScope(records, may, 'complaint_ticket')
    expect(scoped.map((r) => r.id)).toEqual(['1'])
  })
})
