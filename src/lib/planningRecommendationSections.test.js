import { describe, expect, it } from 'vitest'
import {
  attachPlanningRecommendationSections,
  buildPlanningRecommendationSections,
  ensureMinProductActions,
} from './planningRecommendationSections.js'

function makeRecord(overrides = {}) {
  return {
    id: crypto.randomUUID(),
    ticketId: 'T-001',
    source: '工单',
    rawText: 'test',
    createdAt: '2025-06-15T10:00:00Z',
    importMonth: '2025-06',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    painPoint: '安全组未放行特定端口导致业务访问中断。',
    optimizationProduct: '在绑定成功页增加高频业务端口连通性一键检测。',
    sentiment: 'negative',
    ...overrides,
  }
}

describe('planningRecommendationSections', () => {
  it('buildPlanningRecommendationSections includes product actions from ticket optimizations', () => {
    const pool = [
      makeRecord(),
      makeRecord({
        id: crypto.randomUUID(),
        optimizationProduct: '在控制台增加端口占用冲突检测，绑定后自动提示需放行的安全组规则。',
      }),
    ]
    const sections = buildPlanningRecommendationSections(
      {
        id: 'rec-1',
        priority: 'high',
        category: 'product',
        summary: '建议弹性公网 IP：完善连通性诊断与默认策略引导，降低端口不通重复咨询。',
        text: '建议弹性公网 IP：完善连通性诊断与默认策略引导，降低端口不通重复咨询。',
        signalType: 'journey_hotspot',
        evidenceNote: '旅程 业务使用与连通→公网访问不通：3 条工单',
        metrics: [{ label: '环节', value: '公网访问不通' }],
        trackingMetrics: ['环节投诉占比', '30天复发率'],
      },
      pool,
    )

    expect(sections.executiveSummary).toMatch(/连通性诊断/)
    expect(sections.productActions?.length).toBeGreaterThanOrEqual(2)
    expect(sections.clusterRootCause?.painClusters?.length).toBeGreaterThan(0)
    expect(sections.verification?.metrics?.length).toBeGreaterThan(0)
  })

  it('prefers manualReviewOptimization over auto suggestions', () => {
    const pool = [
      makeRecord({
        manualReviewOptimization: '建立端口不通类工单自动化诊断脚本，首响自动输出拦截报告。',
        optimizationProduct: '不应参与聚类分析的旧自动建议内容。',
      }),
    ]
    const sections = buildPlanningRecommendationSections(
      {
        id: 'rec-manual',
        priority: 'medium',
        category: 'product',
        summary: '建议优化端口不通诊断流程，缩短首响排查路径。',
        text: '建议优化端口不通诊断流程，缩短首响排查路径。',
        signalType: 'problem_type',
      },
      pool,
    )

    const joined = (sections.productActions || []).join('\n')
    expect(joined).toMatch(/自动化诊断/)
    expect(joined).not.toMatch(/不应参与/)
  })

  it('ensureMinProductActions pads from fallback details', () => {
    const sections = ensureMinProductActions(
      { productActions: ['完善控制台报错提示与默认策略说明。'] },
      ['建立端到端链路质量探测工具，区分平台与客户侧问题。'],
    )
    expect(sections.productActions?.length).toBeGreaterThanOrEqual(2)
  })

  it('attachPlanningRecommendationSections syncs legacy details', () => {
    const pool = [
      makeRecord({
        painPoint: '专线链路中断导致业务无法互通。',
        optimizationProduct: '在专线控制台增加链路状态自检与拓扑上传引导页。',
      }),
      makeRecord({
        id: crypto.randomUUID(),
        optimizationProduct: '建立信息不全工单自动催办机制，避免工单空转。',
        optimizationService: '建立信息不全工单自动催办机制，避免工单空转。',
      }),
    ]
    const sections = buildPlanningRecommendationSections(
      {
        id: 'rec-2',
        priority: 'medium',
        category: 'product',
        summary: '建议完善专线控制台链路自检能力。',
        text: '建议完善专线控制台链路自检能力。',
        details: [],
        signalType: 'journey_hotspot',
      },
      pool,
    )
    const attached = attachPlanningRecommendationSections(
      {
        id: 'rec-2',
        priority: 'medium',
        category: 'product',
        summary: '建议完善专线控制台链路自检能力。',
        text: '建议完善专线控制台链路自检能力。',
        details: [],
        signalType: 'journey_hotspot',
      },
      pool,
    )

    expect(
      (sections.productActions?.length || 0) + (sections.serviceActions?.length || 0),
    ).toBeGreaterThanOrEqual(1)
    expect(attached.details?.length).toBeGreaterThanOrEqual(2)
  })
})
