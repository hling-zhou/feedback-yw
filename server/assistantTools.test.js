import { describe, expect, it } from 'vitest'
import { ASSISTANT_TOOLS, ASSISTANT_TOOL_NAMES } from './assistantTools.js'

describe('assistantTools structure', () => {
  it('exposes the expected tool set', () => {
    expect(ASSISTANT_TOOL_NAMES).toEqual(
      expect.arrayContaining([
        'list_periods',
        'get_period_overview',
        'get_source_snapshot',
        'get_wan_tou',
        'summarize_post_use',
        'list_actions',
        'list_ticket_todos',
        'list_post_use_jira',
        'search_records',
        'get_record',
      ]),
    )
    expect(ASSISTANT_TOOL_NAMES).toHaveLength(10)
  })

  it('every tool has a fn and description', () => {
    for (const name of ASSISTANT_TOOL_NAMES) {
      const tool = ASSISTANT_TOOLS[name]
      expect(typeof tool.fn).toBe('function')
      expect(typeof tool.description).toBe('string')
      expect(tool.description.length).toBeGreaterThan(0)
    }
  })

  it('list_periods returns periods from storageRepository', () => {
    const result = ASSISTANT_TOOLS.list_periods.fn({})
    expect(result).toHaveProperty('periods')
    expect(Array.isArray(result.periods)).toBe(true)
  })

  it('get_period_overview returns missing for unknown period', () => {
    const result = ASSISTANT_TOOLS.get_period_overview.fn({ insightPeriodId: 'no-such-period' })
    expect(result).toEqual({ status: 'missing' })
  })

  it('get_source_snapshot returns missing for unknown period', () => {
    const result = ASSISTANT_TOOLS.get_source_snapshot.fn({
      insightPeriodId: 'no-such-period',
      dataSourceType: 'complaint_ticket',
    })
    expect(result).toEqual({ status: 'missing' })
  })

  it('search_records returns empty for single-character queries', () => {
    const result = ASSISTANT_TOOLS.search_records.fn({
      importMonth: '2026-08',
      dataSourceType: 'complaint_ticket',
      query: '超',
    })
    expect(result.results).toEqual([])
    expect(result.error).toMatch(/2/)
  })

  it('search_records accepts a two-character Chinese keyword', () => {
    const result = ASSISTANT_TOOLS.search_records.fn({
      importMonth: '2026-08',
      dataSourceType: 'complaint_ticket',
      query: '体验',
    })
    expect(result.error).toBeUndefined()
    expect(Array.isArray(result.results)).toBe(true)
  })

  it('search_records requires a single importMonth or year', () => {
    const result = ASSISTANT_TOOLS.search_records.fn({
      dataSourceType: 'complaint_ticket',
      query: '网关超时',
    })
    expect(result.needNarrowerScope).toBe(true)
    expect(result.results).toEqual([])
  })

  it('search_records returns needNarrowerScope when period covers more than 3 months', () => {
    const result = ASSISTANT_TOOLS.search_records.fn({
      insightPeriodId: 'period:year:2026',
      query: '网关超时',
    })
    expect(result.needNarrowerScope).toBe(true)
    expect(result.coveredMonths).toBeGreaterThan(3)
  })

  it('search_records accepts a year and returns total + results', () => {
    const result = ASSISTANT_TOOLS.search_records.fn({
      year: '2026',
      dataSourceType: 'complaint_ticket',
      query: '体验账号',
    })
    expect(result.needNarrowerScope).toBeUndefined()
    expect(result).toHaveProperty('total')
    expect(Array.isArray(result.results)).toBe(true)
  })

  it('search_records rejects a range over 12 months', () => {
    const result = ASSISTANT_TOOLS.search_records.fn({
      importMonthFrom: '2025-01',
      importMonthTo: '2026-06',
      query: '体验账号',
    })
    expect(result.needNarrowerScope).toBe(true)
    expect(result.results).toEqual([])
  })

  it('get_record returns missing for unknown record', () => {
    const result = ASSISTANT_TOOLS.get_record.fn({ recordId: 'no-such-record' })
    expect(result).toEqual({ status: 'missing' })
  })
})
