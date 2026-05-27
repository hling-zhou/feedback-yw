import { describe, expect, it } from 'vitest'
import {
  categoryAxisWidth,
  ellipsizeCategoryLabel,
  horizontalBarChartLayout,
} from './chartConstants.js'

describe('chartConstants category axis', () => {
  it('widens axis for longer Chinese labels', () => {
    const short = categoryAxisWidth(['登录'])
    const long = categoryAxisWidth(['云主机无法远程登录连接'])
    expect(long).toBeGreaterThan(short)
  })

  it('ellipsize only when exceeding room', () => {
    expect(ellipsizeCategoryLabel('短标签', 120)).toBe('短标签')
    const long = ellipsizeCategoryLabel('云主机无法远程登录连接超时失败', 60)
    expect(long.endsWith('…')).toBe(true)
    expect(long.length).toBeLessThan('云主机无法远程登录连接超时失败'.length)
  })

  it('horizontalBarChartLayout returns yAxisWidth and margin', () => {
    const layout = horizontalBarChartLayout([{ name: '请求协助', count: 3 }])
    expect(layout.yAxisWidth).toBeGreaterThanOrEqual(88)
    expect(layout.margin.right).toBeGreaterThan(0)
    expect(typeof layout.formatLabel).toBe('function')
  })
})
