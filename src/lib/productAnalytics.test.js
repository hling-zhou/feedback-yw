import { describe, expect, it } from 'vitest'
import { topCommonOptimizations } from './productAnalytics.js'
import { getCommonOptimizationText } from './ticketAnalysis/ticketAnalysisSources.js'

describe('getCommonOptimizationText', () => {
  it('prefers established action over auto optimization', () => {
    const text = getCommonOptimizationText({
      establishedAction: '确立举措 A',
      optimizationProduct: '产品优化',
      optimizationService: '服务优化',
    })
    expect(text).toBe('确立举措 A')
  })

  it('falls back to product/service auto optimization', () => {
    const text = getCommonOptimizationText({
      optimizationProduct: '产品优化',
      optimizationService: '服务优化',
    })
    expect(text).toBe('产品优化；服务优化')
  })
})

describe('topCommonOptimizations', () => {
  it('aggregates by optimization text and respects journey filter', () => {
    const items = [
      {
        journeyL1: '开通',
        journeyL2: '子环节',
        optimizationProduct: '优化 A',
      },
      {
        journeyL1: '开通',
        journeyL2: '子环节',
        optimizationProduct: '优化 A',
      },
      {
        journeyL1: '其他',
        optimizationProduct: '优化 B',
      },
    ]
    const all = topCommonOptimizations(items)
    expect(all[0]).toEqual({ text: '优化 A', count: 2 })

    const scoped = topCommonOptimizations(items, '开通', '子环节')
    expect(scoped).toHaveLength(1)
    expect(scoped[0].count).toBe(2)
  })
})
