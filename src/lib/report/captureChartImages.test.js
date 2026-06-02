import { describe, expect, it } from 'vitest'
import { chartTargetsForScope } from './captureChartImages.js'

describe('captureChartImages', () => {
  it('chartTargetsForScope returns overview charts', () => {
    const targets = chartTargetsForScope('overview')
    expect(targets.map((t) => t.title)).toEqual([
      '各产品万投比（投诉工单）',
      '跨源月度趋势（工单类合计）',
    ])
  })

  it('chartTargetsForScope includes complaint-only charts', () => {
    const targets = chartTargetsForScope('complaint_ticket')
    expect(targets.some((t) => t.title === '投诉原因（终判）分布')).toBe(true)
  })
})
