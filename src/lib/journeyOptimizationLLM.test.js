import { describe, expect, it } from 'vitest'
import {
  formatChildMeasuresForPrompt,
  formatMeasureListForPrompt,
  buildJourneyOptimizationContext,
} from './journeyOptimizationLLM.js'

describe('journeyOptimizationLLM prompts', () => {
  it('formatChildMeasuresForPrompt lists L2 measures under each label', () => {
    const text = formatChildMeasuresForPrompt({
      绑定与网络配置: [{ text: '优化绑定流程', source: 'AI 分析' }],
      公网访问不通: [
        { text: '完善连通性诊断', source: 'AI 分析' },
        { text: '沉淀不通 playbook', source: 'AI 分析' },
      ],
    })
    expect(text).toContain('绑定与网络配置')
    expect(text).toContain('优化绑定流程')
    expect(text).toContain('公网访问不通')
    expect(text).toContain('1. 完善连通性诊断')
  })

  it('formatMeasureListForPrompt numbers parent measures', () => {
    expect(
      formatMeasureListForPrompt([{ text: '建立一级总领方向', source: 'AI 分析' }]),
    ).toBe('1. 建立一级总领方向')
  })

  it('buildJourneyOptimizationContext aggregates pain points and ticket optimizations', () => {
    const ctx = buildJourneyOptimizationContext(
      [
        {
          id: '1',
          painPoint: '安全组未放行特定端口导致业务访问中断。',
          problemType: '公网访问不通',
          optimizationProduct: '增加端口连通性一键检测。',
        },
        {
          id: '2',
          painPoint: '安全组未放行特定端口导致业务访问中断。',
          problemType: '公网访问不通',
          manualReviewOptimization: '人工复核：建立端口不通自动化诊断脚本。',
        },
      ],
      '业务使用与连通',
      '公网访问不通',
    )

    expect(ctx.painPoints[0].text).toMatch(/安全组未放行/)
    expect(ctx.painPoints[0].count).toBe(2)
    expect(ctx.ticketOptimizations.some((o) => o.source === '人工复核优化建议')).toBe(true)
    expect(ctx.samples[0].painPoint).toMatch(/安全组/)
  })
})
