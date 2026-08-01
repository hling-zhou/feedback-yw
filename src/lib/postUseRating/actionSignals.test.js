import { describe, expect, it } from 'vitest'
import { buildPostUseActionSignals, filterActionsForMonthlyReport } from './actionSignals.js'
import { visitMonthForReport } from './visitRecords.js'

describe('actionSignals', () => {
  it('flags satisfaction below baseline when n>=10', () => {
    const signals = buildPostUseActionSignals({
      internalSat: {
        byProduct: [
          { productName: 'A', rate: 75, sampleSize: 12 },
          { productName: 'B', rate: 70, sampleSize: 4 },
          { productName: 'C', rate: 90, sampleSize: 20 },
        ],
      },
      internalExp: { byProduct: [] },
    })
    expect(signals.map((s) => s.productName)).toEqual(['A'])
    expect(signals[0].type).toBe('satisfaction_below')
  })

  it('filters monthly report actions by month and product', () => {
    const items = [
      {
        id: '1',
        productName: '弹性公网IP',
        status: 'in_progress',
        firstProposedAt: '2026-06-10',
        createdAt: '2026-06-10',
      },
      {
        id: '2',
        productName: '弹性公网IP',
        status: 'completed',
        firstProposedAt: '2026-05-01',
        updatedAt: '2026-06-15T00:00:00.000Z',
      },
      {
        id: '3',
        productName: '云主机',
        status: 'in_progress',
        firstProposedAt: '2026-06-01',
      },
    ]
    const proposed = filterActionsForMonthlyReport(items, {
      reportMonth: '2026-06',
      productNames: ['弹性公网IP'],
      mode: 'this_month_proposed',
    })
    expect(proposed.map((i) => i.id)).toEqual(['1'])
    const closed = filterActionsForMonthlyReport(items, {
      reportMonth: '2026-06',
      productNames: ['弹性公网IP'],
      mode: 'closed_in_month',
    })
    expect(closed.map((i) => i.id)).toEqual(['2'])
  })
})

describe('visitMonthForReport', () => {
  it('uses the same imported data month as the online scope', () => {
    expect(visitMonthForReport('2026-06')).toBe('2026-06')
    expect(visitMonthForReport('2026-01')).toBe('2026-01')
  })
})
