import { describe, expect, it } from 'vitest'
import { collectEffectiveOptimizationsFromRecords } from './effectiveOptimizationCollect.js'
import { getEffectiveOptimization } from './ticketOptimizationExtract.js'

describe('ticketOptimizationExtract', () => {
  it('getEffectiveOptimization ignores product group and designer suggestions', () => {
    const record = {
      optimizationProduct: '自动产品优化建议内容足够长用于测试',
      optimizationService: '',
      productGroupOptimization: '产品组专项建议不应进入语料',
      designerOptimization: '设计师专项建议不应进入语料',
    }

    const eff = getEffectiveOptimization(record)
    expect(eff.combined).toContain('自动产品优化')
    expect(eff.combined).not.toContain('产品组')
    expect(eff.combined).not.toContain('设计师')
  })

  it('collectEffectiveOptimizationsFromRecords excludes product group and designer', () => {
    const records = [
      {
        optimizationProduct: '控制台增加端口连通性一键检测与放行引导说明',
        productGroupOptimization: '产品组：统一交互规范与组件库',
        designerOptimization: '设计师：优化绑定成功页信息层级',
      },
    ]

    const collected = collectEffectiveOptimizationsFromRecords(records)
    const joined = collected.map((item) => item.text).join('\n')
    expect(joined).toContain('端口连通性')
    expect(joined).not.toContain('产品组')
    expect(joined).not.toContain('设计师')
  })
})
