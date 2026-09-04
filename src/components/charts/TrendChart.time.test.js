import { describe, expect, it } from 'vitest'
import { parseChartXToTs } from './TrendChart.jsx'

describe('parseChartXToTs', () => {
  it('parses YYYY-MM as first day of month', () => {
    expect(parseChartXToTs('2026-08')).toBe(Date.parse('2026-08-01T00:00:00'))
  })

  it('parses YYYY-MM-DD to that day', () => {
    expect(parseChartXToTs('2026-08-15')).toBe(Date.parse('2026-08-15T00:00:00'))
    expect(parseChartXToTs('2026-08-15')).toBeGreaterThan(parseChartXToTs('2026-08'))
    expect(parseChartXToTs('2026-08-15')).toBeLessThan(parseChartXToTs('2026-09'))
  })

  it('returns NaN for empty or invalid', () => {
    expect(Number.isNaN(parseChartXToTs(''))).toBe(true)
    expect(Number.isNaN(parseChartXToTs('not-a-date'))).toBe(true)
  })
})
