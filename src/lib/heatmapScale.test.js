import { describe, expect, it } from 'vitest'
import {
  columnStats,
  getRowFieldValue,
  heatBackground,
  heatColumnPercentLabel,
  heatLegendGradient,
} from './heatmapScale.js'

describe('heatmapScale', () => {
  it('getRowFieldValue reads nested dataIndex', () => {
    expect(getRowFieldValue({ sentiments: { negative: 3 } }, ['sentiments', 'negative'])).toBe(3)
    expect(getRowFieldValue({ total: 5 }, 'total')).toBe(5)
  })

  it('columnStats returns min 0 and column max', () => {
    expect(
      columnStats(
        [{ total: 2 }, { total: 8 }, { total: 5 }],
        'total',
      ),
    ).toEqual({ min: 0, max: 8 })
  })

  it('heatBackground returns undefined for zero or empty max', () => {
    expect(heatBackground(0, { max: 10, rgb: [239, 68, 68] })).toBeUndefined()
    expect(heatBackground(5, { max: 0, rgb: [239, 68, 68] })).toBeUndefined()
  })

  it('heatBackground scales alpha by column max', () => {
    const low = heatBackground(2, { max: 10, rgb: [239, 68, 68], alphaMin: 0.1, alphaMax: 0.5 })
    const high = heatBackground(10, { max: 10, rgb: [239, 68, 68], alphaMin: 0.1, alphaMax: 0.5 })
    expect(low).toBe('rgba(239, 68, 68, 0.180)')
    expect(high).toBe('rgba(239, 68, 68, 0.500)')
  })

  it('heatColumnPercentLabel rounds column share', () => {
    expect(heatColumnPercentLabel(4, 8)).toBe(50)
    expect(heatColumnPercentLabel(0, 8)).toBeNull()
  })

  it('heatLegendGradient builds css gradient', () => {
    expect(heatLegendGradient([239, 68, 68])).toContain('linear-gradient')
    expect(heatLegendGradient([239, 68, 68])).toContain('rgba(239, 68, 68, 0.08)')
  })
})
