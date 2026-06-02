import { describe, expect, it } from 'vitest'
import { FINAL_CLUSTER_TOP_N } from './painPointClustering/constants.js'
import {
  buildEvidenceNoteForSignal,
  buildFallbackPrimaryAction,
  buildProblemTypePrimaryAction,
  buildPlanningRecommendationLlmRules,
  buildPlanningRecommendationsHelpSections,
  buildPrimaryActionForSignal,
  buildScopeLabel,
  formatScopedSummary,
  PLANNING_RECOMMENDATION_LIMITS,
  stripProductActionAroundPrefix,
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

  it('buildPlanningRecommendationsHelpSections aligns with V2 clustering constants', () => {
    const sections = buildPlanningRecommendationsHelpSections()
    const blob = JSON.stringify(sections)
    expect(sections).toHaveLength(4)
    expect(blob).toContain('痛点聚类')
    expect(blob).toContain(String(FINAL_CLUSTER_TOP_N))
    expect(blob).toContain('客户请求内容')
    expect(blob).toContain('单条工单优化建议')
    expect(blob).toContain('刷新洞察')
  })

  it('stripProductActionAroundPrefix removes 围绕 lead-in from product actions', () => {
    expect(
      stripProductActionAroundPrefix(
        '围绕临时带宽扩容缺乏自助申请通道，完善产品能力说明、控制台引导与自助查询，降低重复咨询成本。',
      ),
    ).toBe('完善产品能力说明、控制台引导与自助查询，降低重复咨询成本。')
    expect(stripProductActionAroundPrefix('完善控制台报错提示与默认策略说明。')).toBe(
      '完善控制台报错提示与默认策略说明。',
    )
  })
})
