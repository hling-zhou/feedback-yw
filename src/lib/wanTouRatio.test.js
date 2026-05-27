import { describe, it, expect } from 'vitest'
import {
  computeMonthlyWanTou,
  computeAverageWanTou,
  computeWanTouPeriodDelta,
  formatWanTouPeriodDelta,
  buildWanTouSummary,
  monthsInYear,
  listMonthsForPeriod,
} from './wanTouRatio.js'
import { buildPeriodSpec, insightPeriodFromSpec } from '../domain/insightPeriod.js'

describe('wanTouRatio', () => {
  it('computeMonthlyWanTou = complaints/orders*10000', () => {
    expect(computeMonthlyWanTou(10, 1000)).toBe(100)
    expect(computeMonthlyWanTou(10, 0)).toBeNull()
  })

  it('year granularity averages 12 monthly ratios', () => {
    const period = insightPeriodFromSpec(
      buildPeriodSpec({ granularity: 'year', year: 2025 }),
      1,
    )
    expect(listMonthsForPeriod(period).length).toBe(12)
    expect(monthsInYear(2025)[0]).toBe('2025-01')

    const summary = buildWanTouSummary({
      period,
      productKey: 'eip',
      productName: '弹性公网IP',
      records: Array.from({ length: 10 }, (_, i) => ({
        importMonth: '2025-01',
        product: '弹性公网IP',
        id: `a-${i}`,
      })).concat(
        Array.from({ length: 10 }, (_, i) => ({
          importMonth: '2025-02',
          product: '弹性公网IP',
          id: `b-${i}`,
        })),
      ),
      orderVolumes: [
        { productKey: 'eip', month: '2025-01', orderCount: 10000 },
        { productKey: 'eip', month: '2025-02', orderCount: 10000 },
      ],
    })
    expect(summary.months.length).toBe(12)
    expect(summary.displayRatio).toBeCloseTo(10, 5)
  })

  it('computeAverageWanTou ignores null months', () => {
    expect(computeAverageWanTou([100, null, 200])).toBe(150)
  })

  it('computeWanTouPeriodDelta and format', () => {
    expect(computeWanTouPeriodDelta(120, 100)).toBe(20)
    expect(formatWanTouPeriodDelta(20)).toBe('+20.00')
    expect(formatWanTouPeriodDelta(-3.5)).toBe('-3.50')
    expect(computeWanTouPeriodDelta(100, null)).toBeNull()
  })
})
