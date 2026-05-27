import { describe, it, expect } from 'vitest'
import {
  applyKeywordKeepList,
  buildKeywordAnalysisContext,
  buildKeywordFilterPrompts,
  buildKeywordSampleLines,
} from './keywordLlmFilter.js'
import { isMeaninglessKeyword } from './keywordExtraction.js'

describe('keywordLlmFilter', () => {
  it('buildKeywordFilterPrompts focuses on product planning criteria', () => {
    const { systemPrompt } = buildKeywordFilterPrompts(
      [{ word: '客户侧', count: 5 }, { word: '带宽不足', count: 3 }],
      ['[情绪:不满][产品:云专线] 无法扩容'],
      { sampleCount: 10, negativePct: 40, negativeCount: 4, productHint: '云专线' },
    )
    expect(systemPrompt).toContain('问题集中在哪里')
    expect(systemPrompt).toContain('用户诉求')
    expect(systemPrompt).toContain('情绪')
    expect(systemPrompt).toContain('测试')
    expect(systemPrompt).toContain('客户侧')
    expect(systemPrompt).toContain('ipv')
  })

  it('buildKeywordSampleLines includes sentiment and product', () => {
    const lines = buildKeywordSampleLines([
      {
        id: '1',
        product: '云专线',
        sentiment: 'negative',
        problemSummary: '带宽不足',
        customerQuote: '',
        rawText: '',
      },
    ])
    expect(lines[0]).toContain('情绪')
    expect(lines[0]).toContain('云专线')
    expect(lines[0]).toContain('带宽不足')
  })

  it('buildKeywordAnalysisContext summarizes negatives', () => {
    const ctx = buildKeywordAnalysisContext([
      { id: '1', sentiment: 'negative', product: '云专线' },
      { id: '2', sentiment: 'positive', product: '云专线' },
    ])
    expect(ctx.sampleCount).toBe(2)
    expect(ctx.negativePct).toBe(50)
    expect(ctx.productHint).toContain('云专线')
  })

  it('applyKeywordKeepList preserves order from candidates', () => {
    const candidates = [
      { word: '带宽不足', count: 10 },
      { word: 'Mbps', count: 8 },
      { word: '丢包', count: 5 },
    ]
    const out = applyKeywordKeepList(['带宽不足', '丢包'], candidates)
    expect(out.map((c) => c.word)).toEqual(['带宽不足', '丢包'])
  })

  it('local filter blocks 测试 客户侧 ipv', () => {
    expect(isMeaninglessKeyword('测试')).toBe(true)
    expect(isMeaninglessKeyword('客户侧')).toBe(true)
    expect(isMeaninglessKeyword('ipv')).toBe(true)
    expect(isMeaninglessKeyword('ipv4')).toBe(true)
    expect(isMeaninglessKeyword('带宽不足')).toBe(false)
  })
})
