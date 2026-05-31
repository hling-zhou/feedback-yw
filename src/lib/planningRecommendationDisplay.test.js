import { describe, expect, it } from 'vitest'
import {
  formatClusterRootCauseForExport,
  formatVerificationForExport,
  normalizeClusterRootCause,
  normalizeVerification,
  resolveEffectiveRecommendation,
  resolveRecommendationSummary,
} from './planningRecommendationDisplay.js'

describe('planningRecommendationDisplay', () => {
  it('normalizeClusterRootCause parses legacy string segments', () => {
    const cluster = normalizeClusterRootCause(
      '需求痛点聚集：「端口不通」12 单。根因「安全组未放行」8 单。数据表现：负面占比 42%，占本期 4%',
    )
    expect(cluster?.painClusters).toHaveLength(1)
    expect(cluster?.rootCauses).toHaveLength(1)
    expect(cluster?.dataMetrics?.[0]).toMatch(/负面占比/)
  })

  it('normalizeClusterRootCause parses new label format', () => {
    const cluster = normalizeClusterRootCause(
      '高频痛点：「端口不通」12 单；「连通异常」5 单。高频根因：「安全组未放行」8 单。数据表现：工单 20 条',
    )
    expect(cluster?.painClusters).toHaveLength(2)
    expect(cluster?.rootCauses).toHaveLength(1)
    expect(cluster?.dataMetrics?.[0]).toMatch(/工单/)
  })

  it('formatClusterRootCauseForExport renders structured cluster', () => {
    const text = formatClusterRootCauseForExport({
      painClusters: [{ text: '端口不通', count: 12 }],
      rootCauses: [{ text: '安全组未放行', count: 8 }],
      dataMetrics: ['工单 20 条'],
    })
    expect(text).toMatch(/高频痛点/)
    expect(text).toMatch(/高频根因/)
  })

  it('normalizeVerification splits metric and user validation', () => {
    const verification = normalizeVerification(
      '指标监控：环节投诉占比、30 天复发率；用户验证：抽样回访修复工单并跟踪同类问题复现率。',
    )
    expect(verification?.metrics).toHaveLength(2)
    expect(verification?.userValidation).toMatch(/抽样回访/)
  })

  it('formatVerificationForExport renders structured verification', () => {
    const text = formatVerificationForExport({
      metrics: ['环节投诉占比', '30 天复发率'],
      userValidation: '抽样回访修复工单。',
    })
    expect(text).toMatch(/指标监控/)
    expect(text).toMatch(/用户验证/)
  })

  it('resolveRecommendationSummary prefers sections and user override', () => {
    const rec = {
      id: 'r1',
      summary: '旧 summary',
      text: '旧 text',
      sections: { executiveSummary: 'Phase2 执行摘要一句。' },
    }
    expect(resolveRecommendationSummary(rec)).toBe('Phase2 执行摘要一句。')

    const edited = {
      ...rec,
      userOverride: { summary: '人工编辑后的摘要。', updatedAt: '2025-06-01' },
    }
    expect(resolveRecommendationSummary(edited)).toBe('人工编辑后的摘要。')
    const effective = resolveEffectiveRecommendation(edited)
    expect(effective.sections?.executiveSummary).toBe('人工编辑后的摘要。')
  })
})
