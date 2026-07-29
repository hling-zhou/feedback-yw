import { describe, expect, it } from 'vitest'
import {
  buildPeriodSpec,
  listMonthsInclusive,
  normalizeInsightPeriod,
  periodIdFromSpec,
  periodSpecFromId,
  previousPeriodSpecFromSpec,
  resolvePreviousInsightPeriod,
  selectionFromPeriod,
  shiftYearMonth,
} from './insightPeriod.js'
import { resolveTrendMonthWindow } from '../lib/workbenchTrendWindow.js'

describe('insightPeriod custom range', () => {
  it('buildPeriodSpec creates stable custom id and dates', () => {
    const spec = buildPeriodSpec({
      granularity: 'custom',
      fromMonth: '2024-01',
      toMonth: '2025-02',
    })
    expect(spec.label).toBe('2024年1月–2025年2月')
    expect(spec.startDate).toBe('2024-01-01')
    expect(spec.endDate).toBe('2025-02-28')
    expect(periodIdFromSpec(spec)).toBe('period:custom:2024-01_2025-02')
  })

  it('periodSpecFromId round-trips custom', () => {
    const spec = periodSpecFromId('period:custom:2026-02_2026-04')
    expect(spec?.customFromMonth).toBe('2026-02')
    expect(spec?.customToMonth).toBe('2026-04')
    expect(spec?.startDate).toBe('2026-02-01')
    expect(spec?.endDate).toBe('2026-04-30')
  })

  it('normalizeInsightPeriod does not rewrite custom into month/quarter/year', () => {
    const period = {
      id: 'period:custom:2024-11_2025-01',
      label: 'x',
      startDate: '2024-11-01',
      endDate: '2025-01-31',
      granularity: 'custom',
      customFromMonth: '2024-11',
      customToMonth: '2025-01',
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    }
    const n = normalizeInsightPeriod(period)
    expect(n.granularity).toBe('custom')
    expect(n.customFromMonth).toBe('2024-11')
    expect(n.customToMonth).toBe('2025-01')
    expect(n.startDate).toBe('2024-11-01')
    expect(n.endDate).toBe('2025-01-31')
  })

  it('previous custom window shifts by equal length', () => {
    const spec = buildPeriodSpec({
      granularity: 'custom',
      fromMonth: '2025-04',
      toMonth: '2025-06',
    })
    const prev = previousPeriodSpecFromSpec(spec)
    expect(prev?.customFromMonth).toBe('2025-01')
    expect(prev?.customToMonth).toBe('2025-03')
    const period = {
      id: periodIdFromSpec(spec),
      ...spec,
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    }
    const prevPeriod = resolvePreviousInsightPeriod(period)
    expect(prevPeriod?.customFromMonth).toBe('2025-01')
    expect(prevPeriod?.customToMonth).toBe('2025-03')
  })

  it('selectionFromPeriod includes from/to for custom', () => {
    const spec = buildPeriodSpec({
      granularity: 'custom',
      fromMonth: '2026-01',
      toMonth: '2026-03',
    })
    const sel = selectionFromPeriod({
      id: periodIdFromSpec(spec),
      ...spec,
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    })
    expect(sel).toEqual({
      granularity: 'custom',
      year: 2026,
      fromMonth: '2026-01',
      toMonth: '2026-03',
    })
  })

  it('listMonthsInclusive and shiftYearMonth helpers', () => {
    expect(listMonthsInclusive('2024-11', '2025-01')).toEqual([
      '2024-11',
      '2024-12',
      '2025-01',
    ])
    expect(shiftYearMonth('2025-01', -1)).toBe('2024-12')
  })
})

describe('resolveTrendMonthWindow', () => {
  it('month/quarter/year use full calendar year', () => {
    const month = buildPeriodSpec({ granularity: 'month', year: 2026, month: 5 })
    const w = resolveTrendMonthWindow({
      id: periodIdFromSpec(month),
      ...month,
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    })
    expect(w.startMonth).toBe('2026-01')
    expect(w.endMonth).toBe('2026-12')
    expect(w.months).toHaveLength(12)
    expect(w.baselineYear).toBe(2026)
  })

  it('custom uses inclusive range and latest year as baseline', () => {
    const spec = buildPeriodSpec({
      granularity: 'custom',
      fromMonth: '2024-01',
      toMonth: '2025-02',
    })
    const w = resolveTrendMonthWindow({
      id: periodIdFromSpec(spec),
      ...spec,
      status: 'active',
      tenantId: 'local',
      schemaVersion: '2.0',
      createdAt: '',
      updatedAt: '',
    })
    expect(w.startMonth).toBe('2024-01')
    expect(w.endMonth).toBe('2025-02')
    expect(w.months[0]).toBe('2024-01')
    expect(w.months.at(-1)).toBe('2025-02')
    expect(w.baselineYear).toBe(2025)
  })
})
