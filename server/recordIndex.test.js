import { describe, expect, it } from 'vitest'
import {
  buildRecordsWhereClause,
  importMonthRangeForPeriod,
  parseRecordPagination,
  recordIndexFields,
} from './recordIndex.js'

describe('recordIndexFields', () => {
  it('derives importMonth from createdAt when missing', () => {
    expect(recordIndexFields({ createdAt: '2025-03-15' }).importMonth).toBe('2025-03')
  })

  it('normalizes dataSourceType default', () => {
    expect(recordIndexFields({}).dataSourceType).toBe('complaint_ticket')
  })
})

describe('buildRecordsWhereClause', () => {
  it('filters by tenant and source', () => {
    const { where, params } = buildRecordsWhereClause(
      { tenantId: 't1', dataSourceType: 'complaint_ticket' },
      null,
    )
    expect(where).toContain('tenant_id = ?')
    expect(where).toContain('data_source_type = ?')
    expect(params).toEqual(['t1', 'complaint_ticket'])
  })

  it('adds import_month range for period', () => {
    const period = {
      id: 'p1',
      label: '2025 Q1',
      startDate: '2025-01-01',
      endDate: '2025-03-31',
    }
    const { where, params } = buildRecordsWhereClause({ insightPeriodId: 'p1' }, period)
    expect(where).toContain('import_month >= ?')
    expect(params).toEqual(['2025-01', '2025-03'])
  })
})

describe('parseRecordPagination', () => {
  it('returns null limit when omitted', () => {
    expect(parseRecordPagination({})).toEqual({ limit: null, offset: 0 })
  })

  it('caps limit at 5000', () => {
    expect(parseRecordPagination({ limit: '99999', offset: '2' })).toEqual({
      limit: 5000,
      offset: 2,
    })
  })
})

describe('importMonthRangeForPeriod', () => {
  it('uses YYYY-MM from period dates', () => {
    const range = importMonthRangeForPeriod({
      id: 'x',
      label: 'test',
      startDate: '2024-11-01',
      endDate: '2025-02-28',
    })
    expect(range).toEqual({ startMonth: '2024-11', endMonth: '2025-02' })
  })
})
