import { describe, expect, it } from 'vitest'
import {
  buildEnrichmentRetagWarnings,
  computeTicketLlmEnrichmentDelta,
  countOptimizationRetries,
  createEmptyEnrichmentStats,
  formatTicketLlmRemainRuleMessage,
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
      ticketLlmRegressed: 0,
    })
  })

  it('R-02: computeTicketLlmEnrichmentDelta counts llm→rule regression, excludes manual takeover', () => {
    const before = [
      // R1: llm → 双 rule，真退化
      { dataSourceType: 'complaint_ticket', customerRequestSource: 'llm', painPointSource: 'llm' },
      // R2: llm → 请求 rule + 痛点 manual，仍算退化（存在 rule 来源）
      { dataSourceType: 'complaint_ticket', customerRequestSource: 'llm', painPointSource: 'llm' },
      // R3: llm → 双 manual（人工接管），不算退化
      {
        dataSourceType: 'complaint_ticket',
        customerRequestSource: 'llm',
        painPointSource: 'llm',
        manualTagFields: ['customerRequest', 'painPoint'],
        customerRequest: '人工维护的请求',
        painPoint: '人工维护的痛点',
      },
      // R4: llm → 双 llm，无变化
      { dataSourceType: 'complaint_ticket', customerRequestSource: 'llm', painPointSource: 'llm' },
    ]
    const after = [
      { dataSourceType: 'complaint_ticket' },
      {
        dataSourceType: 'complaint_ticket',
        painPointSource: 'manual',
        manualTagFields: ['painPoint'],
        painPoint: '人工维护的痛点',
      },
      {
        dataSourceType: 'complaint_ticket',
        customerRequestSource: 'manual',
        painPointSource: 'manual',
        manualTagFields: ['customerRequest', 'painPoint'],
        customerRequest: '人工维护的请求',
        painPoint: '人工维护的痛点',
      },
      {
        dataSourceType: 'complaint_ticket',
        customerRequestSource: 'llm',
        painPointSource: 'llm',
      },
    ]
    expect(computeTicketLlmEnrichmentDelta(before, after)).toEqual({
      ticketLlmCompleted: 0,
      ticketLlmFailed: 0,
      ticketLlmRegressed: 2,
    })
  })

  it('buildEnrichmentRetagWarnings guides retag scopes', () => {
    const stats = { ...createEmptyEnrichmentStats(), ticketLlmFailed: 2 }
    const warnings = buildEnrichmentRetagWarnings(stats, 3)
    expect(warnings[0]).toContain('仍为「规则」')
    expect(warnings[0]).toContain('Network')
    expect(warnings[1]).toContain('补打旅程')
  })

  it('formatTicketLlmRemainRuleMessage returns empty for zero failures', () => {
    expect(formatTicketLlmRemainRuleMessage(0)).toBe('')
  })

  it('countOptimizationRetries', () => {
    expect(countOptimizationRetries([{ optimizationRetry: true }, {}])).toBe(1)
  })
})
