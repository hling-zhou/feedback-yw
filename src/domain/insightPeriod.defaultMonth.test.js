import { describe, expect, it } from 'vitest'
import { defaultMonthPeriodSpec } from './insightPeriod.js'

describe('defaultMonthPeriodSpec', () => {
  it('picks latest importMonth in current year', () => {
    const year = new Date().getFullYear()
    const spec = defaultMonthPeriodSpec([
      { importMonth: `${year}-03` },
      { importMonth: `${year}-07` },
      { importMonth: `${year}-05` },
    ])
    expect(spec.granularity).toBe('month')
    expect(spec.anchorYear).toBe(year)
    expect(spec.anchorMonth).toBe(7)
  })

  it('ignores other years and falls back to current month when empty', () => {
    const year = new Date().getFullYear()
    const spec = defaultMonthPeriodSpec([{ importMonth: `${year - 1}-12` }])
    expect(spec.anchorYear).toBe(year)
    expect(spec.anchorMonth).toBe(new Date().getMonth() + 1)
  })
})
