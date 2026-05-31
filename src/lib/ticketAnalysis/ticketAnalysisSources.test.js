import { describe, expect, it } from 'vitest'
import {
  formatListOptimizationPreview,
  getDisplayCustomerRequest,
  getDisplayPainPoint,
  getOptimizationSource,
  getOptimizationSourceLabel,
  getPainPointSource,
  getCustomerRequestSource,
} from './ticketAnalysisSources.js'

describe('ticketAnalysisSources', () => {
  it('detects llm vs rule sources', () => {
    expect(getPainPointSource({ painPointSource: 'llm' })).toBe('llm')
    expect(getPainPointSource({})).toBe('rule')
    expect(getCustomerRequestSource({ customerRequestSource: 'llm' })).toBe('llm')
    expect(getCustomerRequestSource({})).toBe('rule')
    expect(getOptimizationSource({ optimizationSource: 'llm' })).toBe('llm')
    expect(getOptimizationSource({ manualReviewOptimization: '人工建议' })).toBe('manual')
  })

  it('labels optimization source for UI', () => {
    expect(getOptimizationSourceLabel('manual')).toBe('人工复核')
    expect(getOptimizationSourceLabel('llm')).toBe('大模型')
  })

  it('prefers structured display fields', () => {
    const record = {
      customerRequest: '端口不通',
      painPoint: '安全组未放行端口',
      problemSummary: '旧摘要',
      optimizationProduct: '产品优化A',
      optimizationService: '流程优化B',
    }
    expect(getDisplayCustomerRequest(record)).toBe('端口不通')
    expect(getDisplayPainPoint(record)).toBe('安全组未放行端口')
    expect(formatListOptimizationPreview(record)).toMatch(/产品优化A/)
    expect(formatListOptimizationPreview(record)).toMatch(/流程优化B/)
  })
})
