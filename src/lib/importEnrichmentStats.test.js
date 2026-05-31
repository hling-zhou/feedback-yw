import { describe, expect, it } from 'vitest'
import {
  buildEnrichmentRetagWarnings,
  computeTicketLlmEnrichmentDelta,
  countOptimizationRetries,
  createEmptyEnrichmentStats,
} from './importEnrichmentStats.js'

describe('importEnrichmentStats', () => {
  it('R-01: computeTicketLlmEnrichmentDelta tracks completed vs failed', () => {
    const before = [
      { dataSourceType: 'complaint_ticket' },
      { dataSourceType: 'complaint_ticket' },
      {
        dataSourceType: 'complaint_ticket',
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        optimizationSource: 'llm',
      },
    ]
    const after = [
      {
        dataSourceType: 'complaint_ticket',
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        optimizationSource: 'llm',
      },
      { dataSourceType: 'complaint_ticket' },
      {
        dataSourceType: 'complaint_ticket',
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        optimizationSource: 'llm',
      },
    ]
    expect(computeTicketLlmEnrichmentDelta(before, after)).toEqual({
      ticketLlmCompleted: 1,
      ticketLlmFailed: 1,
    })
  })

  it('buildEnrichmentRetagWarnings guides retag scopes', () => {
    const stats = { ...createEmptyEnrichmentStats(), ticketLlmFailed: 2 }
    const warnings = buildEnrichmentRetagWarnings(stats, 3)
    expect(warnings[0]).toContain('待 LLM 增强')
    expect(warnings[1]).toContain('待旅程 LLM')
  })

  it('countOptimizationRetries', () => {
    expect(countOptimizationRetries([{ optimizationRetry: true }, {}])).toBe(1)
  })
})
