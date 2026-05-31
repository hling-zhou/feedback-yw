import { describe, expect, it } from 'vitest'
import {
  buildEvidenceNoteForSignal,
  buildFallbackPrimaryAction,
  buildProblemTypePrimaryAction,
  buildPlanningRecommendationLlmRules,
  buildPlanningRecommendationsHelpSections,
  buildPrimaryActionForSignal,
  buildScopeLabel,
  formatScopedSummary,
  LARGE_PRODUCT_TICKET_THRESHOLD,
  PLANNING_RECOMMENDATION_LIMITS,
  trackingMetricsForSignal,
} from './planningRecommendationTemplate.js'

describe('planningRecommendationTemplate', () => {
  it('formatScopedSummary applies scoped prefix', () => {
    const summary = formatScopedSummary(
      '「云专线·订购开通与加急」',
      '建立开通全流程可观测与加急 SLA 机制，降低交付不确定性。',
    )
    expect(summary).toMatch(/^建议「云专线·订购开通与加急」：/)
    expect(summary.length).toBeLessThanOrEqual(PLANNING_RECOMMENDATION_LIMITS.maxSummaryLength)
  })

  it('buildScopeLabel prefers product+journey', () => {
    expect(
      buildScopeLabel({
        product: '云专线',
        journeyL1: '开通与交付',
        journeyL2: '订购开通与加急',
      }),
    ).toBe('「云专线·订购开通与加急」')
  })

  it('buildEvidenceNoteForSignal keeps stats in evidence only', () => {
    const note = buildEvidenceNoteForSignal({
      signalType: 'problem_type',
      problemType: '产品功能需求',
      count: 8,
      sharePct: 22,
    })
    expect(note).toMatch(/8 单/)
    expect(note).toMatch(/22%/)
  })

  it('buildPrimaryActionForSignal returns action-oriented wan_tou text', () => {
    const text = buildPrimaryActionForSignal('wan_tou', {
      product: '云主机',
      problemType: '公网访问不通',
    })
    expect(text).toMatch(/万投比/)
    expect(text).not.toMatch(/telnet/)
  })

  it('buildFallbackPrimaryAction avoids unknown journey', () => {
    const text = buildFallbackPrimaryAction({
      journeyL1: '业务使用与连通',
      journeyL2: '未知环节',
      problemType: '公网访问不通',
    })
    expect(text).toMatch(/公网访问不通/)
    expect(text).not.toMatch(/未知环节/)
  })

  it('trackingMetricsForSignal returns configured metrics', () => {
    expect(trackingMetricsForSignal('journey_hotspot')).toContain('环节投诉占比')
  })

  it('buildPlanningRecommendationLlmRules documents template constraints', () => {
    const rules = buildPlanningRecommendationLlmRules()
    expect(rules).toMatch(/最多 \d+ 条/)
    expect(rules).toMatch(/productActions/)
    expect(rules).toMatch(/journey_hotspot/)
  })

  it('buildProblemTypePrimaryAction only matches 12-class labels', () => {
    expect(buildProblemTypePrimaryAction('性能问题')).toMatch(/性能基线/)
    expect(buildProblemTypePrimaryAction('性能与质量')).toBeNull()
  })

  it('buildPlanningRecommendationsHelpSections aligns with quota constants', () => {
    const sections = buildPlanningRecommendationsHelpSections()
    const blob = JSON.stringify(sections)
    expect(sections.length).toBeGreaterThanOrEqual(5)
    expect(blob).toContain(String(LARGE_PRODUCT_TICKET_THRESHOLD))
    expect(blob).toContain('云专线')
    expect(blob).toContain('刷新洞察')
  })
})
