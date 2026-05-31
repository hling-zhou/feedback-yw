import { describe, expect, it } from 'vitest'
import {
  buildDimensionTaggingText,
  buildDimensionTaggingTextForRecord,
  buildFullTaggingTextForRecord,
} from './dimensionTaggingText.js'

describe('dimensionTaggingText', () => {
  it('prefers customerRequest + painPoint', () => {
    expect(
      buildDimensionTaggingText({
        customerRequest: 'IP不通，请排查',
        painPoint: '端口被安全组拦截',
        handlingText: '协办：已指导客户修改安全组',
      }),
    ).toBe('IP不通，请排查\n端口被安全组拦截')
  })

  it('llmCorpusOnly returns empty when ticket LLM did not run', () => {
    const record = {
      customerRequest: '规则版请求',
      customerRequestSource: 'rule',
      rawText: '受理：无法访问公网',
    }
    expect(buildDimensionTaggingTextForRecord(record, { llmCorpusOnly: true })).toBe('')
  })

  it('llmCorpusOnly uses LLM customerRequest', () => {
    const record = {
      customerRequest: 'LLM精炼请求',
      customerRequestSource: 'llm',
      painPoint: '规则痛点',
      painPointSource: 'rule',
      rawText: 'noise',
    }
    expect(buildDimensionTaggingTextForRecord(record, { llmCorpusOnly: true })).toBe('LLM精炼请求')
  })

  it('llmCorpusOnly includes LLM painPoint', () => {
    const record = {
      customerRequest: 'LLM精炼请求',
      customerRequestSource: 'llm',
      painPoint: 'LLM痛点',
      painPointSource: 'llm',
      rawText: 'noise',
    }
    expect(buildDimensionTaggingTextForRecord(record, { llmCorpusOnly: true })).toBe(
      'LLM精炼请求\nLLM痛点',
    )
  })

  it('buildFullTaggingTextForRecord includes handling layers', () => {
    const record = {
      rawText: '受理：客户反馈不通',
      handlingText: '协办：ping通，对端reset',
    }
    expect(buildFullTaggingTextForRecord(record)).toMatch(/不通/)
    expect(buildFullTaggingTextForRecord(record)).toMatch(/ping通/)
  })
})
