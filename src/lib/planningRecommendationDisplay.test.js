import { describe, expect, it } from 'vitest'
import {
  buildRecommendationExportFullText,
  formatClusterRootCauseForExport,
  formatPainClusterScoresForExport,
  formatRecommendationSectionsForExport,
  formatVerificationForExport,
  normalizeClusterRootCause,
  normalizeVerification,
  resolveRecommendationSummary,
} from './planningRecommendationDisplay.js'

describe('planningRecommendationDisplay', () => {
  it('normalizeClusterRootCause parses legacy string segments', () => {
    const cluster = normalizeClusterRootCause(
      '需求痛点聚集：「端口不通」12 单。业务影响：负面占比高，需优先闭环。',
    )
    expect(cluster?.painClusters).toHaveLength(1)
    expect(cluster?.businessImpact).toMatch(/负面占比/)
  })

  it('normalizeClusterRootCause parses pain label format', () => {
    const cluster = normalizeClusterRootCause(
      '痛点：「端口不通」12 单；「连通异常」5 单。',
    )
    expect(cluster?.painClusters).toHaveLength(2)
  })

  it('formatClusterRootCauseForExport renders structured cluster', () => {
    const text = formatClusterRootCauseForExport({
      painClusters: [{ text: '端口不通', count: 12 }],
    })
    expect(text).toMatch(/痛点/)
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

  it('formatPainClusterScoresForExport matches overview V2 display fields', () => {
    const text = formatPainClusterScoresForExport(
      {
        priorityScore: 4.2,
        rank: 1,
        totalFinal: 10,
        breadthScore: 3.5,
        sharePct: 12.5,
        ticketCount: 8,
        harmScore: 4.1,
        maxSeverity: 5,
        p90Emotion: 3.2,
        sourceDistributionLines: ['投诉：6件（占比75%），涉及一级环节：开通(4件)'],
        customerTierSummary: '金牌2，银牌1',
      },
      '安全组未放行导致端口不通',
    )
    expect(text).toMatch(/排名：1\/10/)
    expect(text).toMatch(/来源与一级环节分布/)
    expect(text).not.toMatch(/洞察摘要/)
  })

  it('buildRecommendationExportFullText includes V2 block before cluster sections', () => {
    const text = buildRecommendationExportFullText({
      id: 'v2',
      priority: 'high',
      category: 'product',
      summary: '代表痛点',
      text: '代表痛点',
      sections: {
        executiveSummary: '代表痛点',
        painClusterScores: {
          priorityScore: 4,
          rank: 1,
          totalFinal: 5,
          breadthScore: 3,
          sharePct: 10,
          ticketCount: 4,
          harmScore: 3.5,
          maxSeverity: 4,
          p90Emotion: 2,
          sourceDistributionLines: [],
          customerTierSummary: '—',
        },
        productActions: ['优化控制台引导'],
        verification: { metrics: ['复发率'], userValidation: '回访' },
      },
    })
    expect(text).toMatch(/优先级评定/)
    expect(text).toMatch(/可执行改进建议/)
    expect(text).toMatch(/闭环验证机制/)
    expect(text).not.toMatch(/详细意见/)
  })

  it('formatRecommendationSectionsForExport mirrors overview section blocks', () => {
    const text = formatRecommendationSectionsForExport(
      {
        painClusterScores: {
          priorityScore: 4,
          rank: 1,
          totalFinal: 5,
          breadthScore: 3,
          sharePct: 10,
          ticketCount: 4,
          harmScore: 3.5,
          maxSeverity: 4,
          p90Emotion: 2,
          sourceDistributionLines: ['投诉：4件（占比100%）'],
          customerTierSummary: '金牌1',
        },
        executiveSummary: '端口不通',
        productActions: ['优化引导'],
      },
      '端口不通',
    )
    expect(text).toMatch(/【洞察摘要】/)
    expect(text).toMatch(/端口不通/)
    expect(text).toMatch(/产品\/技术优化/)
  })

  it('resolveRecommendationSummary prefers sections executiveSummary', () => {
    const rec = {
      id: 'r1',
      summary: '旧 summary',
      text: '旧 text',
      sections: { executiveSummary: 'Phase2 执行摘要一句。' },
    }
    expect(resolveRecommendationSummary(rec)).toBe('Phase2 执行摘要一句。')
  })
})
