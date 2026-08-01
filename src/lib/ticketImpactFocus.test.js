import { describe, expect, it } from 'vitest'
import {
  buildImpactFocusSummaryRule,
  buildImpactFocusSummaries,
  mergeImpactFocusSummary,
} from './ticketImpactFocus.js'

const record = (id, overrides = {}) => ({
  id,
  ticketId: `T-${id}`,
  dataSourceType: 'complaint_ticket',
  product: '弹性公网IP',
  problemType: '可用性/连通性故障',
  journeyL1: '使用',
  journeyL2: '连通性验证',
  painPoint: '公网IP无法访问',
  sentiment: 'negative',
  importMonth: '2026-06',
  ...overrides,
})

describe('ticketImpactFocus', () => {
  it('links formal clusters and fallback references to impact evidence', async () => {
    const records = [
      record('1', { customerTier: '金牌', followUpSatisfaction: { score: 6, problemResolved: 'unresolved' } }),
      record('2', { product: '云服务器 ECS', problemType: '配置与操作', journeyL1: '开通', painPoint: '控制台入口不清晰', sentiment: 'neutral_inquiry', urgencyLevel: 'high' }),
    ]
    const recommendations = [
      {
        id: 'cluster-1',
        stableKey: 'pcl-1',
        signalType: 'pain_cluster_v2',
        summary: '公网IP无法访问',
        scope: { product: '弹性公网IP', problemType: '可用性/连通性故障', journeyL1: '使用' },
        evidenceRecordIds: ['1'],
        sections: { painClusterScores: { ticketCount: 1 } },
      },
      {
        id: 'fallback-1',
        stableKey: 'pfr-1',
        signalType: 'journey_problem_fallback',
        summary: '控制台入口不清晰',
        scope: { product: '云服务器 ECS', problemType: '配置与操作', journeyL1: '开通' },
        evidenceRecordIds: ['2'],
        evidenceBundle: { ticketCount: 1 },
      },
    ]

    const result = await buildImpactFocusSummaries({
      sourceLabel: '投诉工单',
      recommendations,
      records,
      settings: null,
    })

    expect(result.all.summary.status).toBe('linked')
    expect(result.all.themeLinks).toEqual(expect.arrayContaining([
      expect.objectContaining({ themeId: 'pcl-1', evidenceRecordIds: ['1'] }),
      expect.objectContaining({ themeId: 'pfr-1', evidenceRecordIds: ['2'], inferred: true }),
    ]))
    expect(result.byProduct['弹性公网IP'].summary.focusItems[0]).toMatchObject({ themeId: 'pcl-1' })
  })

  it('falls back to evidence-only summary when no theme is available', () => {
    const result = buildImpactFocusSummaryRule({
      scopeLabel: '投诉工单整体',
      recommendations: [],
      records: [record('1', { urgencyLevel: 'high' })],
    })

    expect(result.summary.status).toBe('evidence_only')
    expect(result.themeLinks).toEqual([])
    expect(result.ungroupedEvidenceRecordIds).toEqual(['1'])
  })

  it('rejects llm focus items that reference unknown theme ids', () => {
    const ruleSummary = buildImpactFocusSummaryRule({
      scopeLabel: '投诉工单整体',
      recommendations: [{
        id: 'cluster-1',
        stableKey: 'pcl-1',
        signalType: 'pain_cluster_v2',
        summary: '公网IP无法访问',
        scope: { product: '弹性公网IP', problemType: '可用性/连通性故障', journeyL1: '使用' },
        evidenceRecordIds: ['1'],
        sections: { painClusterScores: { ticketCount: 1 } },
      }],
      records: [record('1', { urgencyLevel: 'high' })],
    }).summary

    const merged = mergeImpactFocusSummary(ruleSummary, {
      executiveSummary: '错误的结果',
      focusItems: [{ themeId: 'unknown-theme', summary: '不应被接受', riskLevel: 'high' }],
    })

    expect(merged).toEqual(ruleSummary)
  })
})
