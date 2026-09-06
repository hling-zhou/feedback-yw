import { describe, expect, it } from 'vitest'
import { randomId } from '../lib/randomId.js'
import { CLUSTER_ACTION_SYNTHESIS_VERSION } from '../lib/painPointClustering/clusterActionSynthesis.js'
import {
  needsOverviewRecommendationsRehydrate,
  prepareOverviewConclusionsForDisplay,
  refreshStaleV2RecommendationSections,
  rehydrateOverviewRecommendations,
  OVERVIEW_RECOMMENDATIONS_REFRESH_NOTE,
  OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE,
} from './rehydrateOverviewRecommendations.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
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
  it('needsOverviewRecommendationsRehydrate when recommendationEngine missing or non-V2', () => {
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
        recommendationsMeta: { recommendationEngine: 'pain_cluster_v2_4' },
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

  it('rehydrates old snapshot conclusions with cluster recommendations', () => {
    const pain = '安全组规则未放行导致公网端口无法访问'
    const records = Array.from({ length: 4 }, () => makeRecord({ painPoint: pain }))
    const oldConclusions = {
      insightPeriodId: 'p-2025-06',
      recommendations: [{ id: 'legacy-1', summary: '旧版建议', signalType: 'problem_type' }],
      recommendationsMeta: { ruleVersion: 'planning-v1' },
      dataCoverageNotes: [],
    }
    const rehydrated = rehydrateOverviewRecommendations(oldConclusions, records, null)
    expect(rehydrated.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
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
    expect(rehydrated.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
    expect(rehydrated.recommendationsMeta?.legacyFallback).toBe(false)
    expect(rehydrated.recommendations[0].signalType).toBe('pain_cluster_v2')
    expect(rehydrated.recommendations[0].id).not.toBe('legacy-1')
  })

  it('returns unchanged when already V2', () => {
    const conclusions = {
      recommendationsMeta: { recommendationEngine: 'pain_cluster_v2_4' },
      recommendations: [],
    }
    expect(rehydrateOverviewRecommendations(conclusions, [makeRecord()], null)).toBe(conclusions)
  })

  it('无工单时清空建议并提示重新生成快照', () => {
    const oldConclusions = {
      recommendations: [{ id: 'legacy-1', summary: '旧版建议' }],
      recommendationsMeta: {},
      dataCoverageNotes: [],
    }
    const rehydrated = rehydrateOverviewRecommendations(oldConclusions, [], null)
    expect(rehydrated.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
    expect(rehydrated.recommendations).toHaveLength(0)
    expect(rehydrated.dataCoverageNotes?.some((n) => n.includes('无工单数据'))).toBe(true)
  })

  it('V2 空结果 → 清空建议并写入空结果提示', () => {
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
    expect(rehydrated.recommendationsMeta?.recommendationEngine).toBe('pain_cluster_v2_4')
    expect(rehydrated.recommendationsMeta?.legacyFallback).toBe(false)
    expect(rehydrated.recommendations).toHaveLength(0)
    expect(rehydrated.dataCoverageNotes).toContain(OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE)
  })
})

describe('refreshStaleV2RecommendationSections', () => {
  it('replaces ticket-excerpt productActions with cluster synthesis on display', () => {
    const r1 = makeRecord({
      painPoint: '关于广州资源池需要将三个共享带宽的弹性公网IP数量提升至40。',
      journeyL2: '配额与权限',
      problemType: '配额与权限申请',
      optimizationProduct:
        '围绕「关于广州资源池需要将三个共享带宽的弹性公网IP数量提升至40。」完善控制台报错提示与默认策略说明。',
    })
    const r2 = makeRecord({
      painPoint: '关于广州资源池需要将1个共享带宽的弹性公网IP数量提升至40。',
      journeyL2: '配额与权限',
      problemType: '配额与权限申请',
      optimizationProduct:
        '围绕「关于广州资源池需要将1个共享带宽的弹性公网IP数量提升至40。」完善控制台报错提示与默认策略说明。',
    })
    const staleRec = {
      id: 'rec-stale',
      priority: 'medium',
      category: 'product',
      signalType: 'pain_cluster_v2',
      summary: '关于广州资源池需要将三个共享带宽的弹性公网IP数量提升至40。',
      text: '关于广州资源池需要将三个共享带宽的弹性公网IP数量提升至40。',
      evidenceRecordIds: [r1.id, r2.id],
      generationMeta: { representativePain: '关于广州资源池需要将三个共享带宽的弹性公网IP数量提升至40。' },
      scope: { product: '弹性公网 IP', problemType: '配额与权限申请' },
      sections: {
        productActions: [
          r1.optimizationProduct,
          r2.optimizationProduct,
        ],
      },
      productActionsSource: 'ticket',
    }
    const [refreshed] = refreshStaleV2RecommendationSections([staleRec], [r1, r2])
    expect(refreshed.productActionsSource).toBe('synth')
    expect(refreshed.sections?.productActions).toHaveLength(2)
    const joined = refreshed.sections?.productActions?.join('\n') || ''
    expect(joined).not.toMatch(/围绕「关于广州资源池/)
    expect(joined).toMatch(/配额|控制台|广州资源池/)
  })

  it('replaces ticket-metadata executiveSummary even when productActions already synth v2', () => {
    const dirtySummary =
      '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：本司一共12台云主机实例ID为【618d0314-****-*----'
    const r1 = makeRecord({
      customerRequest: dirtySummary,
      painPoint: '',
      journeyL2: '业务规则咨询/查询',
      journeyL1: '全局流转',
      problemType: '配置与操作',
    })
    const r2 = makeRecord({
      customerRequest: dirtySummary,
      painPoint: '',
      journeyL2: '业务规则咨询/查询',
      journeyL1: '全局流转',
      problemType: '配置与操作',
    })
    const staleRec = {
      id: 'rec-dirty-summary',
      priority: 'medium',
      category: 'product',
      signalType: 'pain_cluster_v2',
      summary: dirtySummary,
      text: dirtySummary,
      evidenceRecordIds: [r1.id, r2.id],
      evidenceBundle: { ticketCount: 2 },
      generationMeta: {
        representativePain: dirtySummary,
        actionSynthesisVersion: 2,
      },
      scope: { product: '弹性云主机', journeyL2: '业务规则咨询/查询' },
      sections: {
        executiveSummary: dirtySummary,
        productActions: ['针对该类问题完善控制台说明与默认策略。', '补充配额申请入口与审批进度可见性。'],
      },
      productActionsSource: 'synth',
    }
    const [refreshed] = refreshStaleV2RecommendationSections([staleRec], [r1, r2])
    const summary = refreshed.sections?.executiveSummary || refreshed.summary || ''
    expect(summary).not.toMatch(/请求节点|工单标题|详细内容：/)
    expect(summary).toMatch(/本司一共12台云主机/)
    expect(summary).not.toMatch(/集中反馈|请求节点/)
    expect(refreshed.generationMeta?.actionSynthesisVersion).toBe(CLUSTER_ACTION_SYNTHESIS_VERSION)
  })

  it('replaces background-narrative executiveSummary on display', () => {
    const background =
      '由于我单位近期承接了大量短视频AI智能剪辑、以及高画质游戏画面的渲染处理业----'
    const r1 = makeRecord({ painPoint: background, customerRequest: background })
    const r2 = makeRecord({
      painPoint: '云主机内存不足导致渲染任务频繁 OOM。',
      customerRequest: background,
    })
    const staleRec = {
      id: 'rec-bg-summary',
      signalType: 'pain_cluster_v2',
      summary: background,
      text: background,
      evidenceRecordIds: [r1.id, r2.id],
      evidenceBundle: { ticketCount: 2 },
      generationMeta: { representativePain: background, actionSynthesisVersion: 4 },
      scope: { product: '弹性云主机' },
      sections: {
        executiveSummary: `${background}（2 条工单）`,
        productActions: ['完善产品能力说明、控制台引导与自助查询，降低重复咨询成本。', '补充规则 FAQ。'],
      },
      productActionsSource: 'synth',
    }
    const [refreshed] = refreshStaleV2RecommendationSections([staleRec], [r1, r2])
    const summary = refreshed.sections?.executiveSummary || refreshed.summary || ''
    expect(summary).toMatch(/内存不足|OOM/)
    expect(summary).not.toMatch(/由于我单位|智能剪辑/)
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

  it('passes through V2 conclusions with empty recommendations', () => {
    const conclusions = {
      recommendations: [],
      recommendationsMeta: { recommendationEngine: 'pain_cluster_v2' },
      dataCoverageNotes: [OVERVIEW_RECOMMENDATIONS_EMPTY_NOTE],
    }
    const result = prepareOverviewConclusionsForDisplay(conclusions)
    expect(result.recommendationsPendingRefresh).toBe(false)
    expect(result.conclusions?.recommendations).toHaveLength(0)
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
