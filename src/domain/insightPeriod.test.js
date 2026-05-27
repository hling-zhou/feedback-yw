import { describe, expect, it } from 'vitest'
import {
  buildPeriodSpec,
  periodIdFromSpec,
  previousPeriodIdFromPeriod,
  previousPeriodSpecFromSpec,
  resolvePreviousInsightPeriod,
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
