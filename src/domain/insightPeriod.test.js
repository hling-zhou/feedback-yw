import { describe, expect, it } from 'vitest'
import {
  buildPeriodSpec,
  periodIdFromSpec,
  previousPeriodIdFromPeriod,
  previousPeriodSpecFromSpec,
  resolvePreviousInsightPeriod,
  toLastMonthSpec,
} from './insightPeriod.js'

describe('insightPeriod previous period', () => {
  it('previousPeriodSpecFromSpec steps back one month', () => {
    const spec = buildPeriodSpec({ granularity: 'month', year: 2025, month: 3 })
    const prev = previousPeriodSpecFromSpec(spec)
    expect(prev?.anchorYear).toBe(2025)
    expect(prev?.anchorMonth).toBe(2)
    expect(periodIdFromSpec(prev)).toBe('period:month:2025-02')
  })

  it('previousPeriodIdFromPeriod returns null for invalid period', () => {
    expect(previousPeriodIdFromPeriod(null)).toBeNull()
  })

  it('resolvePreviousInsightPeriod returns previous month period', () => {
    const spec = buildPeriodSpec({ granularity: 'month', year: 2025, month: 3 })
    const period = {
      id: periodIdFromSpec(spec),
      label: spec.label,
      startDate: spec.startDate,
      endDate: spec.endDate,
      granularity: spec.granularity,
      anchorYear: spec.anchorYear,
      anchorMonth: spec.anchorMonth,
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    }
    const prev = resolvePreviousInsightPeriod(period)
    expect(prev?.label).toBe('2025年2月')
    expect(prev?.anchorMonth).toBe(2)
  })

  it('previousPeriodIdFromPeriod works for quarter', () => {
    const spec = buildPeriodSpec({ granularity: 'quarter', year: 2025, quarter: 1 })
    const period = {
      id: periodIdFromSpec(spec),
      label: spec.label,
      startDate: spec.startDate,
      endDate: spec.endDate,
      granularity: spec.granularity,
      anchorYear: spec.anchorYear,
      anchorQuarter: spec.anchorQuarter,
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    }
    expect(previousPeriodIdFromPeriod(period)).toBe('period:quarter:2024-Q4')
  })
})

describe('toLastMonthSpec', () => {
  /** @param {ReturnType<typeof buildPeriodSpec>} spec */
  function periodFromSpec(spec) {
    return {
      id: periodIdFromSpec(spec),
      label: spec.label,
      startDate: spec.startDate,
      endDate: spec.endDate,
      granularity: spec.granularity,
      anchorYear: spec.anchorYear,
      anchorMonth: spec.anchorMonth,
      anchorQuarter: spec.anchorQuarter,
      customFromMonth: spec.customFromMonth,
      customToMonth: spec.customToMonth,
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    }
  }

  it('month period returns same month', () => {
    const period = periodFromSpec(buildPeriodSpec({ granularity: 'month', year: 2026, month: 5 }))
    const r = toLastMonthSpec(period)
    expect(r.granularity).toBe('month')
    expect(r.anchorYear).toBe(2026)
    expect(r.anchorMonth).toBe(5)
  })

  it('quarter Q2 returns June', () => {
    const period = periodFromSpec(buildPeriodSpec({ granularity: 'quarter', year: 2026, quarter: 2 }))
    const r = toLastMonthSpec(period)
    expect(r.granularity).toBe('month')
    expect(r.anchorYear).toBe(2026)
    expect(r.anchorMonth).toBe(6)
  })

  it('year returns December', () => {
    const period = periodFromSpec(buildPeriodSpec({ granularity: 'year', year: 2026 }))
    const r = toLastMonthSpec(period)
    expect(r.granularity).toBe('month')
    expect(r.anchorYear).toBe(2026)
    expect(r.anchorMonth).toBe(12)
  })

  it('custom range returns toMonth', () => {
    const period = periodFromSpec(
      buildPeriodSpec({ granularity: 'custom', fromMonth: '2026-03', toMonth: '2026-06' }),
    )
    const r = toLastMonthSpec(period)
    expect(r.granularity).toBe('month')
    expect(r.anchorYear).toBe(2026)
    expect(r.anchorMonth).toBe(6)
  })

  it('null returns current month spec', () => {
    const r = toLastMonthSpec(null)
    expect(r.granularity).toBe('month')
  })
})
