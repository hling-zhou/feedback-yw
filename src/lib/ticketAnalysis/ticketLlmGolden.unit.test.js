import { describe, expect, it } from 'vitest'
import {
  GOLDEN_REQUEST_PAIN_JACCARD_MIN,
  estimateTicketLlmCalls,
  llmCallReductionRatio,
  meetsOptimizationGoldenRatio,
  requestPainJaccard,
  textJaccardSimilarity,
} from './ticketLlmGolden.js'

describe('ticketLlmGolden helpers', () => {
  it('textJaccardSimilarity is 1 for identical strings', () => {
    expect(textJaccardSimilarity('公网端口无法访问', '公网端口无法访问')).toBe(1)
  })

  it('requestPainJaccard averages request and pain', () => {
    const score = requestPainJaccard(
      { customerRequest: 'A', painPoint: 'B' },
      { customerRequest: 'A', painPoint: 'B' },
    )
    expect(score).toBe(1)
  })

  it('meetsOptimizationGoldenRatio enforces 90% floor', () => {
    expect(meetsOptimizationGoldenRatio(0.9, 1)).toBe(true)
    expect(meetsOptimizationGoldenRatio(0.89, 1)).toBe(false)
  })

  it('GOLDEN_REQUEST_PAIN_JACCARD_MIN is 0.85', () => {
    expect(GOLDEN_REQUEST_PAIN_JACCARD_MIN).toBe(0.85)
  })
})

describe('llmTaggingAcceptance token budget', () => {
  it('P0 验收：500 条 EIP 场景 LLM 调用降幅 ≥ 40%（unified + 门控 + ticket_first）', () => {
    const records = 500
    const legacy = estimateTicketLlmCalls({
      records,
      ticketLlmMode: 'separate',
      pipelineOrder: 'legacy',
      journeyGatingSkipRate: 0,
    })
    const optimized = estimateTicketLlmCalls({
      records,
      ticketLlmMode: 'unified',
      pipelineOrder: 'ticket_first',
      journeyGatingSkipRate: 0.55,
      optimizationRetryRate: 0.3,
    })

    const reduction = llmCallReductionRatio(legacy.total, optimized.total)
    expect(legacy.total).toBe(500 * (3 + 1))
    expect(reduction).toBeGreaterThanOrEqual(0.4)
  })
})
