import { describe, expect, it } from 'vitest'
import {
  needsOverviewRecommendationsRehydrate,
  prepareOverviewConclusionsForDisplay,
  rehydrateOverviewRecommendations,
  OVERVIEW_RECOMMENDATIONS_REFRESH_NOTE,
} from './rehydrateOverviewRecommendations.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    problemType: '配置与操作',
    journeyL1: '业务使用与连通',
    importMonth: '2025-06',
    painPoint: '安全组规则未放行导致公网端口无法访问',
    ...overrides,
  }
}

describe('rehydrateOverviewRecommendations', () => {
  it('needsOverviewRecommendationsRehydrate when recommendationEngine missing or legacy', () => {
    expect(needsOverviewRecommendationsRehydrate(null)).toBe(false)
    expect(needsOverviewRecommendationsRehydrate({ insufficientData: true })).toBe(false)
    expect(
      needsOverviewRecommendationsRehydrate({
        recommendationsMeta: {},
      }),
    ).toBe(true)
    expect(
      needsOverviewRecommendationsRehydrate({
        recommendationsMeta: { recommendationEngine: 'pain_cluster_v2' },
      }),
    ).toBe(false)
    expect(
      needsOverviewRecommendationsRehydrate({
        recommendationsMeta: { recommendationEngine: 'legacy_planning' },
      }),
    ).toBe(true)
    expect(
      needsOverviewRecommendationsRehydrate({
        recommendationsMeta: { recommendationEngine: 'pain_cluster_v2', legacyFallback: true },
      }),
    ).toBe(true)
  })

  it('rehydrates old snapshot conclusions with V2 cluster recommendations', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = Array.from({ length: 4 }, () => makeRecord({ painPoint: pain }))
    const oldConclusions = {
      insightPeriodId: 'p-2025-06',
      recommendations: [{ id: 'legacy-1', summary: '旧版建议', signalType: 'problem_type' }],
      recommendationsMeta: { ruleVersion: 'planning-v1' },
      dataCoverageNotes: [],
    }
    const rehydrated = rehydrateOverviewRecommendations(oldConclusions, records, null)
    expect(rehydrated.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2')
    expect(rehydrated.recommendationsMeta?.rehydratedAt).toBeTruthy()
    expect(rehydrated.recommendations.length).toBeGreaterThan(0)
    expect(rehydrated.recommendations[0].signalType).toBe('pain_cluster_v2')
    expect(rehydrated.dataCoverageNotes?.some((n) => n.includes('实时重算'))).toBe(true)
  })

  it('rehydrates legacy_planning snapshot when pain points become available', () => {
    const pain = '带宽打满导致业务访问超时'
    const records = Array.from({ length: 4 }, () => makeRecord({ painPoint: pain }))
    const legacyConclusions = {
      insightPeriodId: 'p-2025-06',
      recommendations: [{ id: 'legacy-1', summary: '旧版 playbook 建议', signalType: 'journey' }],
      recommendationsMeta: {
        recommendationEngine: 'legacy_planning',
        legacyFallback: true,
        ruleVersion: 'planning-rec-v2',
      },
      dataCoverageNotes: [],
    }
    const rehydrated = rehydrateOverviewRecommendations(legacyConclusions, records, null)
    expect(rehydrated.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2')
    expect(rehydrated.recommendationsMeta?.legacyFallback).toBe(false)
    expect(rehydrated.recommendations[0].signalType).toBe('pain_cluster_v2')
    expect(rehydrated.recommendations[0].id).not.toBe('legacy-1')
  })

  it('returns unchanged when already V2', () => {
    const conclusions = {
      recommendationsMeta: { recommendationEngine: 'pain_cluster_v2' },
      recommendations: [],
    }
    expect(rehydrateOverviewRecommendations(conclusions, [makeRecord()], null)).toBe(conclusions)
  })

  it('无工单时标记 legacy 并提示重新生成快照', () => {
    const oldConclusions = {
      recommendations: [{ id: 'legacy-1', summary: '旧版建议' }],
      recommendationsMeta: {},
      dataCoverageNotes: [],
    }
    const rehydrated = rehydrateOverviewRecommendations(oldConclusions, [], null)
    expect(rehydrated.recommendationsMeta?.recommendationEngine).toBe('legacy_planning')
    expect(rehydrated.recommendationsMeta?.legacyFallback).toBe(true)
    expect(rehydrated.dataCoverageNotes?.some((n) => n.includes('无工单数据'))).toBe(true)
  })

  it('V2 空结果且存在 legacy recs → 保留 legacy 并标注', () => {
    const oldConclusions = {
      recommendations: [{ id: 'legacy-1', summary: '旧版建议', signalType: 'problem_type' }],
      recommendationsMeta: {},
      dataCoverageNotes: [],
    }
    const records = [
      makeRecord({ painPoint: '', problemSummary: '' }),
      makeRecord({ painPoint: '', problemSummary: '' }),
    ]
    const rehydrated = rehydrateOverviewRecommendations(oldConclusions, records, null)
    expect(rehydrated.recommendationsMeta?.legacyFallback).toBe(true)
    expect(rehydrated.recommendations[0].id).toBe('legacy-1')
    expect(rehydrated.dataCoverageNotes?.some((n) => n.includes('旧版快照'))).toBe(true)
  })
})

describe('prepareOverviewConclusionsForDisplay', () => {
  it('passes through valid V2 conclusions', () => {
    const conclusions = {
      recommendations: [{ id: 'r1', summary: '建议' }],
      recommendationsMeta: { recommendationEngine: 'pain_cluster_v2' },
    }
    const result = prepareOverviewConclusionsForDisplay(conclusions)
    expect(result.recommendationsPendingRefresh).toBe(false)
    expect(result.conclusions).toBe(conclusions)
  })

  it('suppresses recommendations for old snapshot and adds refresh note', () => {
    const conclusions = {
      recommendations: [{ id: 'legacy-1', summary: '旧版建议' }],
      recommendationsMeta: { ruleVersion: 'planning-v1' },
      executiveSummary: '摘要保留',
      dataCoverageNotes: [],
    }
    const result = prepareOverviewConclusionsForDisplay(conclusions)
    expect(result.recommendationsPendingRefresh).toBe(true)
    expect(result.conclusions?.recommendations).toEqual([])
    expect(result.conclusions?.executiveSummary).toBe('摘要保留')
    expect(result.conclusions?.recommendationsMeta?.displaySuppressed).toBe(true)
    expect(result.conclusions?.dataCoverageNotes).toContain(OVERVIEW_RECOMMENDATIONS_REFRESH_NOTE)
  })

  it('suppresses legacy_planning and legacyFallback snapshots', () => {
    expect(
      prepareOverviewConclusionsForDisplay({
        recommendations: [{ id: 'x' }],
        recommendationsMeta: { recommendationEngine: 'legacy_planning' },
      }).recommendationsPendingRefresh,
    ).toBe(true)
    expect(
      prepareOverviewConclusionsForDisplay({
        recommendations: [{ id: 'x' }],
        recommendationsMeta: {
          recommendationEngine: 'pain_cluster_v2',
          legacyFallback: true,
        },
      }).recommendationsPendingRefresh,
    ).toBe(true)
  })
})
