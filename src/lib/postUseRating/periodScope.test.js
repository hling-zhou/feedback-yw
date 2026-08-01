import { describe, expect, it } from 'vitest'
import {
  filterPostUseTrendForPeriod,
  postUsePeriodMonths,
  postUseTrendMonthsForPeriod,
  postUseVisitMonthsForPeriod,
} from './periodScope.js'

const quarter = {
  granularity: 'quarter',
  anchorYear: 2026,
  startDate: '2026-04-01',
  endDate: '2026-06-30',
}

describe('post-use rating period scope', () => {
  it('expands the selected period into inclusive months', () => {
    expect(postUsePeriodMonths(quarter)).toEqual(['2026-04', '2026-05', '2026-06'])
  })

  it('uses the same imported data months for customer visits', () => {
    expect(postUseVisitMonthsForPeriod(quarter)).toEqual(['2026-04', '2026-05', '2026-06'])
  })

  it('uses the whole containing year for month, quarter, and year trends', () => {
    const expected = Array.from({ length: 12 }, (_, index) =>
      `2026-${String(index + 1).padStart(2, '0')}`,
    )
    expect(postUseTrendMonthsForPeriod(quarter)).toEqual(expected)
    expect(
      postUseTrendMonthsForPeriod({
        granularity: 'month',
        anchorYear: 2026,
        startDate: '2026-06-01',
        endDate: '2026-06-30',
      }),
    ).toEqual(expected)
  })

  it('keeps the user-specified month range for custom trends', () => {
    expect(
      postUseTrendMonthsForPeriod({
        granularity: 'custom',
        startDate: '2025-11-01',
        endDate: '2026-02-28',
      }),
    ).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
  })

  it('filters every trend collection to the selected period', () => {
    const filtered = filterPostUseTrendForPeriod(
      {
        scores: [{ month: '2026-03' }, { month: '2026-04' }, { month: '2026-06' }],
        satisfaction: [{ month: '2026-05' }, { month: '2026-07' }, { month: '2027-01' }],
        reasons: [{ month: '2026-04' }, { month: '2025-12' }],
      },
      quarter,
    )
    expect(filtered.scores.map((row) => row.month)).toEqual(['2026-03', '2026-04', '2026-06'])
    expect(filtered.satisfaction.map((row) => row.month)).toEqual(['2026-05', '2026-07'])
    expect(filtered.reasons.map((row) => row.month)).toEqual(['2026-04'])
  })
})
