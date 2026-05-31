import { describe, expect, it } from 'vitest'
import {
  isValidUnifiedOptimization,
  joinUnifiedOptimizationFields,
  normalizeOptimizationStrings,
} from './validateUnifiedOptimization.js'

describe('validateUnifiedOptimization', () => {
  it('isValidUnifiedOptimization requires non-generic product', () => {
    expect(isValidUnifiedOptimization({ productOptimizations: ['加强培训提升体验'] })).toBe(false)
    expect(
      isValidUnifiedOptimization({
        productOptimizations: ['控制台增加安全组规则批量导入与冲突检测提示'],
      }),
    ).toBe(true)
    expect(
      isValidUnifiedOptimization({
        optimizationProduct: '完善带宽变更失败时的错误码与自助 remediation 指引',
      }),
    ).toBe(true)
  })

  it('joinUnifiedOptimizationFields dedupes and filters generic', () => {
    const joined = joinUnifiedOptimizationFields({
      productOptimizations: [
        '控制台增加公网质量诊断与链路拥塞预警看板',
        '控制台增加公网质量诊断与链路拥塞预警看板',
        '优化体验',
      ],
      serviceOptimizations: ['建立跨组升级 SLA 可视化'],
    })
    expect(joined.optimizationProduct).toContain('公网质量')
    expect(joined.optimizationProduct).not.toContain('优化体验')
    expect(joined.optimizationSuggestion).toContain('SLA')
  })

  it('normalizeOptimizationStrings', () => {
    expect(normalizeOptimizationStrings('  a  ')).toEqual(['a'])
    expect(normalizeOptimizationStrings([' x ', ''])).toEqual(['x'])
  })
})
