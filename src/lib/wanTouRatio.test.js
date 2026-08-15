import { describe, it, expect } from 'vitest'
import {
  computeMonthlyWanTou,
  computeAverageWanTou,
  computeWanTouPeriodDelta,
  computeWanTouExcessComplaints,
  evaluateWanTouTarget,
  formatWanTouPeriodDelta,
  formatWanTouRatioWithTarget,
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

  it('evaluateWanTouTarget marks met and excess complaints', () => {
    expect(evaluateWanTouTarget({ ratio: 80, target: 100, orders: 10000, complaints: 80 }).met).toBe(
      true,
    )
    const failed = evaluateWanTouTarget({
      ratio: 120,
      target: 100,
      orders: 10000,
      complaints: 12,
    })
    expect(failed.met).toBe(false)
    expect(failed.excessComplaints).toBe(20)
    expect(computeWanTouExcessComplaints(120, 100, 10000, 12)).toBe(20)
    const pending = evaluateWanTouTarget({ ratio: null, target: 100, orders: null, complaints: 0 })
    expect(pending.hasTarget).toBe(true)
    expect(pending.met).toBeNull()
  })

  it('formatWanTouRatioWithTarget appends target status and excess', () => {
    expect(
      formatWanTouRatioWithTarget(2, {
        hasTarget: true,
        met: false,
        excessComplaints: 1,
        target: 1,
      }),
    ).toBe('2.00（未达标，超量 1 单）')
    expect(
      formatWanTouRatioWithTarget(0.5, {
        hasTarget: true,
        met: true,
        excessComplaints: 0,
        target: 1,
      }),
    ).toBe('0.50（达标）')
  })

  it('buildWanTouSummary compares monthly wan tou and cx targets', () => {
    const period = insightPeriodFromSpec(
      buildPeriodSpec({ granularity: 'month', year: 2025, month: 3 }),
      1,
    )
    const summary = buildWanTouSummary({
      period,
      productKey: 'eip',
      productName: '弹性公网IP',
      records: [
        {
          id: '1',
          importMonth: '2025-03',
          product: '弹性公网IP',
          dataSourceType: 'complaint_ticket',
          complaintCauseL1Final: '客户体验类',
        },
        {
          id: '2',
          importMonth: '2025-03',
          product: '弹性公网IP',
          dataSourceType: 'complaint_ticket',
          complaintCauseL1Final: '性能类',
        },
      ],
      orderVolumes: [{ productKey: 'eip', month: '2025-03', orderCount: 10000 }],
      wanTouTargets: [
        {
          productKey: 'eip',
          year: 2025,
          wanTouTarget: 1,
          customerExperienceWanTouTarget: 0.5,
        },
      ],
    })
    expect(summary.months).toHaveLength(1)
    expect(summary.months[0].complaints).toBe(2)
    expect(summary.months[0].cxComplaints).toBe(1)
    expect(summary.months[0].ratio).toBeCloseTo(2, 5)
    expect(summary.months[0].cxRatio).toBeCloseTo(1, 5)
    expect(summary.months[0].wanTouTargetEval.met).toBe(false)
    expect(summary.months[0].cxWanTouTargetEval.met).toBe(false)
    expect(summary.months[0].wanTouTargetEval.excessComplaints).toBe(1)
    expect(summary.months[0].cxWanTouTargetEval.excessComplaints).toBe(1)
  })
})
