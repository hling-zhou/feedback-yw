import { describe, expect, it } from 'vitest'
import { randomId } from './randomId.js'
import {
  attachPlanningRecommendationSections,
  buildInsightExecutiveSummary,
  buildPlanningRecommendationSections,
  collectPlaybookFallbackProductActions,
  ensureMinProductActions,
  filterPainClustersForDisplay,
  buildPainClustersForDisplay,
  refineProductActionsForPainAlignment,
} from './planningRecommendationSections.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
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
        id: randomId(),
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

  it('collectPlaybookFallbackProductActions fills sparse cluster actions from journey playbook', () => {
    const pool = [
      makeRecord({
        painPoint: '公网端口无法访问业务系统',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        optimizationProduct: '',
        optimizationService: '',
      }),
      makeRecord({
        id: randomId(),
        painPoint: '安全组规则导致端口不通',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        optimizationProduct: '',
      }),
    ]
    const fallback = collectPlaybookFallbackProductActions(pool, {
      id: 'rec-cluster',
      scope: { product: '弹性公网 IP' },
    })
    expect(fallback.length).toBeGreaterThanOrEqual(2)
    expect(fallback.join('\n')).toMatch(/排查|playbook|诊断|自助/)
  })

  it('buildPlanningRecommendationSections uses cluster synthesis for pain_cluster_v2', () => {
    const pool = [
      makeRecord({
        painPoint: '安全组未放行特定端口导致业务访问中断。',
        journeyL2: '公网访问不通',
        problemType: '配置与操作',
        optimizationProduct: '不应直接摘录的单条优化建议内容。',
      }),
      makeRecord({
        id: randomId(),
        painPoint: '安全组未放行特定端口导致业务访问中断。',
        journeyL2: '公网访问不通',
        problemType: '配置与操作',
      }),
    ]
    const sections = buildPlanningRecommendationSections(
      {
        id: 'rec-v2-synth',
        priority: 'high',
        category: 'product',
        summary: '安全组未放行特定端口导致业务访问中断。',
        text: '安全组未放行特定端口导致业务访问中断。',
        signalType: 'pain_cluster_v2',
        generationMeta: { representativePain: '安全组未放行特定端口导致业务访问中断。' },
        scope: { product: '弹性公网 IP', journeyL2: '公网访问不通', problemType: '配置与操作' },
      },
      pool,
    )
    expect(sections.productActions).toHaveLength(2)
    const joined = sections.productActions?.join('\n') || ''
    expect(joined).toMatch(/完善产品能力说明|连通性诊断/)
    expect(joined).not.toMatch(/不应直接摘录|围绕|安全组未放行/)
  })

  it('buildPlanningRecommendationSections uses playbook when optimizations are missing', () => {
    const pool = [
      makeRecord({
        painPoint: '公网端口无法访问业务系统',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        problemType: '可用性/连通性故障',
        optimizationProduct: '',
        optimizationService: '',
      }),
      makeRecord({
        id: randomId(),
        painPoint: '安全组规则导致端口不通',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        problemType: '可用性/连通性故障',
        optimizationProduct: '',
      }),
    ]
    const sections = buildPlanningRecommendationSections(
      {
        id: 'rec-playbook',
        priority: 'high',
        category: 'product',
        summary: '公网端口无法访问业务系统',
        text: '公网端口无法访问业务系统',
        signalType: 'pain_cluster_v2',
        scope: { product: '弹性公网 IP' },
      },
      pool,
    )
    expect(sections.productActions?.length).toBeGreaterThanOrEqual(2)
  })

  it('refineProductActionsForPainAlignment drops misaligned ticket optimizations', () => {
    const pool = [
      makeRecord({
        painPoint: '公网端口无法访问业务系统',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        problemType: '可用性/连通性故障',
        optimizationProduct: '优化账单展示与折扣说明，减少商务类重复咨询。',
      }),
      makeRecord({
        id: randomId(),
        painPoint: '公网端口无法访问业务系统',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        optimizationProduct: '优化账单展示与折扣说明，减少商务类重复咨询。',
      }),
    ]
    const refined = refineProductActionsForPainAlignment(
      {
        executiveSummary: '公网端口无法访问业务系统',
        productActions: ['优化账单展示与折扣说明，减少商务类重复咨询。'],
        verification: { metrics: ['环节投诉占比'], userValidation: '回访' },
      },
      {
        id: 'rec-align',
        scope: { product: '弹性公网 IP' },
      },
      pool,
    )
    expect(refined.actionAlignmentWeak).toBe(true)
    expect(refined.sections.productActions?.join('\n')).not.toMatch(/账单/)
    expect(refined.sections.productActions?.length).toBeGreaterThanOrEqual(2)
  })

  it('attachPlanningRecommendationSections exposes actionAlignmentWeak', () => {
    const pool = [
      makeRecord({
        painPoint: '专线链路中断导致业务无法互通',
        journeyL1: '开通与交付',
        journeyL2: '订购开通与加急',
        optimizationProduct: '建立需求 intake 与排期可视化机制，减少无反馈重复咨询。',
      }),
    ]
    const attached = attachPlanningRecommendationSections(
      {
        id: 'rec-weak',
        priority: 'medium',
        category: 'product',
        summary: '专线链路中断导致业务无法互通',
        text: '专线链路中断导致业务无法互通',
        signalType: 'journey_hotspot',
        scope: { product: '云专线' },
      },
      pool,
    )
    expect(attached.actionAlignmentWeak).toBe(true)
  })

  it('buildPlanningRecommendationSections keeps cluster business impact without verification block', () => {
    const pool = [
      makeRecord({
        painPoint: '公网端口无法访问业务系统',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        sentiment: 'negative',
        customerTier: '金牌',
        optimizationProduct: '完善连通性诊断工具，区分客户侧/平台侧结论。',
      }),
      makeRecord({
        id: randomId(),
        painPoint: '公网端口无法访问业务系统',
        journeyL1: '业务使用与连通',
        journeyL2: '公网访问不通',
        sentiment: 'negative',
        customerTier: '银牌',
        optimizationProduct: '在控制台增加端口冲突检测。',
      }),
    ]
    const sections = buildPlanningRecommendationSections(
      {
        id: 'rec-verify',
        priority: 'high',
        category: 'product',
        summary: '公网端口无法访问业务系统',
        text: '公网端口无法访问业务系统',
        signalType: 'pain_cluster_v2',
        evidenceBundle: { ticketCount: 2, sharePct: 12 },
        scope: { product: '弹性公网 IP' },
      },
      pool,
    )
    expect(sections.verification).toBeUndefined()
    expect(sections.clusterRootCause?.businessImpact).toMatch(/金牌|银牌|负面/)
  })

  it('attachPlanningRecommendationSections syncs legacy details', () => {
    const pool = [
      makeRecord({
        painPoint: '专线链路中断导致业务无法互通。',
        optimizationProduct: '在专线控制台增加链路状态自检与拓扑上传引导页。',
      }),
      makeRecord({
        id: randomId(),
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

  it('buildInsightExecutiveSummary rewrites representative pain into insight sentence', () => {
    const pool = [
      makeRecord({
        journeyL2: '公网访问不通',
        painPoint: '安全组未放行特定端口导致业务访问中断。',
      }),
      makeRecord({ id: randomId(), journeyL2: '公网访问不通' }),
    ]
    const summary = buildInsightExecutiveSummary(
      {
        id: 'rec-insight',
        scope: { product: '弹性公网 IP' },
        evidenceBundle: { ticketCount: 8, sharePct: 12 },
      },
      pool,
      '安全组未放行特定端口导致业务访问中断。',
    )
    expect(summary).toMatch(/安全组未放行特定端口/)
    expect(summary).not.toMatch(/集中反馈|「弹性公网 IP」/)
    expect(summary).toMatch(/8 条工单/)
    expect(summary).toMatch(/占该产品 12%/)
  })

  it('buildInsightExecutiveSummary skips single-ticket background narrative', () => {
    const background =
      '由于我单位近期承接了大量短视频AI智能剪辑、以及高画质游戏画面的渲染处理业----'
    const pool = [
      makeRecord({ painPoint: background, customerRequest: background }),
      makeRecord({
        id: randomId(),
        painPoint: '云主机内存不足导致渲染任务频繁 OOM。',
        customerRequest: background,
      }),
      makeRecord({
        id: randomId(),
        painPoint: '云主机内存不足导致渲染任务频繁 OOM。',
        customerRequest: background,
      }),
    ]
    const summary = buildInsightExecutiveSummary(
      {
        id: 'rec-bg',
        evidenceBundle: { ticketCount: 3 },
      },
      pool,
      background,
    )
    expect(summary).toMatch(/内存不足|OOM/)
    expect(summary).not.toMatch(/由于我单位|智能剪辑|渲染处理业/)
  })

  it('buildPainClustersForDisplay keeps representative pain and adds sharePct', () => {
    const items = buildPainClustersForDisplay(
      [
        { text: '安全组未放行导致端口不通', count: 6 },
        { text: '账单金额计算错误', count: 2 },
      ],
      '安全组未放行导致端口不通。',
      8,
    )
    expect(items).toHaveLength(2)
    expect(items[0].sharePct).toBe(75)
    expect(items[0].isRepresentative).toBe(true)
    expect(items[1].text).toMatch(/账单/)
  })

  it('filterPainClustersForDisplay hides redundant pain clusters', () => {
    const painClusters = [
      { text: '安全组未放行导致端口不通', count: 6 },
      { text: '账单金额计算错误', count: 2 },
    ]
    const filtered = filterPainClustersForDisplay(
      painClusters,
      '安全组未放行导致端口不通。',
    )
    expect(filtered).toHaveLength(1)
    expect(filtered[0].text).toMatch(/账单/)
  })
})
