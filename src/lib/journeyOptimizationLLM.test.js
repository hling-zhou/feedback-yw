import { describe, expect, it } from 'vitest'
import {
  formatChildMeasuresForPrompt,
  formatMeasureListForPrompt,
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
})
