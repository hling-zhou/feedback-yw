import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import TicketStoryView from './TicketStoryView.jsx'

vi.mock('../charts/TrendChart.jsx', () => ({
  default: ({ data = [] }) => <div data-testid="trend-chart">trend:{data.length}</div>,
}))

vi.mock('../charts/ThemeBarChart.jsx', () => ({
  default: ({ data = [] }) => <div data-testid="theme-bar-chart">bars:{data.length}</div>,
}))

function buildModel() {
  return {
    scope: {
      sourceType: 'complaint_ticket',
      sourceLabel: '投诉工单',
      periodLabel: '2026年6月',
      selectedProduct: '全部产品',
      total: 2,
      productCount: 1,
      qualityStatus: '数据质量正常',
      qualityWarningCount: 0,
      pipelineVersion: 'ticket-v1',
      clusteringVersion: 'v2.0',
    },
    conclusions: [
      { key: 'overall', label: '整体状态', value: '负向反馈需重点关注', detail: '工单 2 条', target: '#ticket-status' },
    ],
    overview: {
      metrics: {
        total: 2,
        volumeDelta: 1,
        negativeCount: 2,
        negativePct: 100,
        urgentCount: 0,
        followUpCount: 1,
        followUpTenPointRate: 0,
        unresolvedCount: 1,
        customerExperienceComplaintCount: 2,
        highFrequencyTopicCount: 0,
        repeatConsultationPct: 0,
        selfServicePct: 0,
      },
      productOverview: [
        {
          product: '弹性公网IP',
          count: 2,
          sharePct: 100,
          delta: 1,
          negativeCount: 2,
          negativePct: 100,
          primaryProblem: '公网IP无法访问',
          primaryJourney: '使用',
          followUpEvidence: 1,
          actionStatus: '待创建',
          wanTouRatio: null,
          wanTouTargetMet: null,
          smallSample: true,
        },
      ],
      wanTou: { productKey: null, trend: [], latest: null, evaluation: { target: null } },
    },
    trendsAndChanges: {
      volumeTrend: [{ date: '2026-06', count: 2, negative: 2, negativePct: 100 }],
      changes: [],
      currentMonth: '',
      previousMonth: '',
      previousPeriodLabel: '上月',
      currentPeriodLabel: '本月',
    },
    drivers: {
      requestScenes: [],
      journeyTree: [],
      problemTypes: [],
      journeyLayout: 'empty',
      journeyStages: [],
      journeyChangeHighlights: [],
      complaintCauses: [{ name: '产品能力', count: 2 }],
      emptyState: null,
      clusters: [
        {
          id: 'cluster-1',
          priority: 'high',
          product: '弹性公网IP',
          pain: '公网IP无法访问',
          customerRequest: '客户反馈公网不通',
          rootCause: '安全组未放行',
          ticketCount: 2,
          sharePct: 100,
          breadthScore: 5,
          severity: 5,
          emotion: 4,
          priorityScore: 4.5,
          basis: '痛点聚类 V2：优先级 4.5 分',
        },
      ],
      fallbackReferences: [
        {
          id: 'fallback-1',
          priority: 'low',
          product: '弹性公网IP',
          pain: '控制台配置路径不清晰',
          customerRequest: '客户找不到配置入口',
          rootCause: '缺少路径提示',
          ticketCount: 1,
          sharePct: 50,
          basis: '小产品（1 单）按旅程×问题类型频次推断',
        },
      ],
      opportunities: [],
    },
    impactAndEvidence: {
      highValueCount: 1,
      strongNegativeCount: 0,
      urgentCount: 0,
      unresolvedCount: 1,
      summary: {
        status: 'linked',
        executiveSummary: '当前最需要重点关注的是「公网IP无法访问」，该主题已同时出现高价值客户、回访未解决。',
        focusItems: [
          {
            themeId: 'pcl-1',
            themeLabel: '公网IP无法访问',
            riskLevel: 'high',
            riskSignals: ['高价值客户', '回访未解决'],
            summary: '公网IP无法访问已影响高价值客户，并出现回访未解决。',
            evidenceRecordIds: ['record-1'],
            evidenceTicketIds: ['20260416174551X751972102'],
            inferred: false,
          },
        ],
      },
      themeLinks: [
        {
          themeId: 'pcl-1',
          themeLabel: '公网IP无法访问',
          riskLevel: 'high',
          impactSignals: { highValueCount: 1, negativeCount: 0, urgentCount: 0, unresolvedCount: 1 },
          inferred: false,
          evidenceTicketIds: ['20260416174551X751972102'],
          records: [
            {
              id: 'record-1',
              ticketId: '20260416174551X751972102',
              product: '弹性公网IP',
              customerTier: '战略',
              customerRequest: '客户反馈公网不通，需要尽快排查',
              painPoint: '公网 IP 无法访问',
              rootCause: '云能问题 / 产品原因 / 计算部原因',
              sourceColumns: { 问题原因: '安全组未放行' },
              solutionSummary: '协助核查放通规则',
              followUpSatisfaction: { score: 6, problemResolved: 'unresolved' },
            },
          ],
        },
      ],
      records: [
        {
          id: 'record-1',
          ticketId: '20260416174551X751972102',
          product: '弹性公网IP',
          customerTier: '战略',
          customerRequest: '客户反馈公网不通，需要尽快排查',
          painPoint: '公网 IP 无法访问',
          rootCause: '云能问题 / 产品原因 / 计算部原因',
          sourceColumns: { 问题原因: '安全组未放行' },
          solutionSummary: '协助核查放通规则',
          followUpSatisfaction: { score: 6, problemResolved: 'unresolved' },
        },
      ],
    },
    actionsAndRecovery: {
      rows: [],
      recoveryRows: [],
      pendingActions: 1,
      notImproved: 0,
    },
    quality: {
      pipelineVersion: 'ticket-v1',
      clusteringVersion: 'v2.0',
      tagLibraryVersion: 'tag-v1',
      counts: {
        missingRequestScene: 0,
        missingProblemType: 0,
        missingJourney: 0,
        missingPain: 0,
      },
      anomalies: [],
    },
  }
}

describe('TicketStoryView render', () => {
  it('renders formal cluster and fallback reference sections with distinct columns', () => {
    const html = renderToStaticMarkup(
      <TicketStoryView model={buildModel()} creatingInsightId="" />,
    )
    expect(html).toContain('正式痛点聚类（V2）')
    expect(html).toContain('小样本参考项')
    expect(html).toContain('广度分')
    expect(html).toContain('P90情绪')
    expect(html).toContain('推断型')
    expect(html).toContain('参考主题')
    expect(html).toContain('用户旅程')
    expect(html).toContain('用户旅程按单产品生命周期查看，请选择一个产品。')
    expect(html).not.toContain('一级环节热力')
    expect(html).not.toContain('全部反馈')
    expect(html).not.toContain('请求场景 → 用户旅程 → 问题类型')
    expect(html).not.toContain('title="问题变化"')
    expect(html).toContain('规模')
    expect(html).toContain('体验质量')
    expect(html).toContain('风险与闭环')
    expect(html).toContain('产品总览')
    expect(html).toContain('环比 +1')
    expect(html).not.toContain('投诉原因（终判）')
    expect(html).not.toContain('客户体验类投诉')
  })

  it('prevents long fixed-left ticket ids from overflowing adjacent evidence columns', () => {
    const html = renderToStaticMarkup(
      <TicketStoryView model={buildModel()} creatingInsightId="" />,
    )

    expect(html).toContain('ticket-evidence-table')
    expect(html).toContain('ticket-evidence-table__ticket-link')
    expect(html).toContain('table-layout:fixed')
  })

  it('renders linked impact focus summary and grouped theme evidence', () => {
    const html = renderToStaticMarkup(
      <TicketStoryView model={buildModel()} creatingInsightId="" />,
    )

    expect(html).toContain('重点关注')
    expect(html).toContain('查看该主题证据')
    expect(html).toContain('主题证据')
    expect(html).toContain('在反馈库查看')
    expect(html).toContain('/feedbacks?source=complaint_ticket&amp;ticketIds=20260416174551X751972102')
    expect(html).toContain('环比')
    expect(html).toContain('客户体验类万投比')
    expect(html).toContain('高风险')
    expect(html).toContain('安全组未放行')
    expect(html).not.toContain('云能问题 / 产品原因 / 计算部原因')
    expect(html).not.toContain('解决方案')
  })

  it('renders refresh-empty state when V2 recommendations are pending refresh', () => {
    const model = buildModel()
    model.drivers.clusters = []
    model.drivers.fallbackReferences = []
    model.drivers.emptyState = {
      kind: 'pending_refresh',
      alertType: 'warning',
      title: '当前快照待刷新',
      description: '当前快照未包含可展示的 V2 痛点聚类结果，请先点击「生成 / 刷新洞察」后再查看。',
    }

    const html = renderToStaticMarkup(
      <TicketStoryView model={model} creatingInsightId="" />,
    )

    expect(html).toContain('当前快照待刷新')
    expect(html).toContain('暂无正式痛点聚类结果')
  })

  it('renders product-empty state when current product has no matching recommendations', () => {
    const model = buildModel()
    model.drivers.clusters = []
    model.drivers.fallbackReferences = []
    model.drivers.emptyState = {
      kind: 'product_empty',
      alertType: 'info',
      title: '当前产品暂无结果',
      description: '已切换到「专有网络 VPC」，但该产品在当前周期未形成正式痛点聚类或小样本参考项，可切回“全部产品”查看整体结果。',
    }

    const html = renderToStaticMarkup(
      <TicketStoryView model={model} creatingInsightId="" />,
    )

    expect(html).toContain('当前产品暂无结果')
    expect(html).toContain('专有网络 VPC')
  })

  it('renders product journey map in lifecycle order when a product is selected', () => {
    const model = buildModel()
    model.scope.selectedProduct = '弹性公网IP'
    model.drivers.journeyLayout = 'lifecycle'
    model.drivers.journeyStages = [
      { key: '认知与选型', journeyL1: '认知与选型', count: 0, sharePct: 0, previousCount: 0, currentCount: 0, delta: 0, change: null, headline: '—', actionLabel: '', children: [], topProblemTypes: [], ticketIds: [], empty: true, complaintCount: 0, consultationCount: 0, isFrictionPeak: false },
      { key: '业务使用与连通', journeyL1: '业务使用与连通', count: 2, sharePct: 100, previousCount: 0, currentCount: 2, delta: 2, change: '新增', headline: '公网访问不通', actionLabel: '公网访问不通', children: [], topProblemTypes: [], ticketIds: ['T-1'], empty: false, complaintCount: 2, consultationCount: 0, isFrictionPeak: true },
    ]
    model.drivers.journeyChangeHighlights = [
      { key: '业务使用与连通', journeyL1: '业务使用与连通', change: '新增', previousCount: 0, currentCount: 2, text: '业务使用与连通 0→2，新增' },
    ]
    model.drivers.journeySourceFilter = 'complaint'

    const html = renderToStaticMarkup(
      <TicketStoryView model={model} creatingInsightId="" />,
    )

    expect(html).toContain('用户旅程')
    expect(html).toContain('认知与选型')
    expect(html).toContain('业务使用与连通')
    expect(html).toContain('按弹性公网IP用户旅程一级环节排列')
    expect(html).toContain('体验断点')
    expect(html).toContain('卡在 公网访问不通')
    expect(html).not.toContain('全部反馈')
    expect(html).not.toContain('产品总览')
    expect(html).toContain('首要问题 公网IP无法访问')
    expect(html).toContain('主要旅程 使用')
    expect(html).toContain('举措 待创建')
  })

  it('does not treat a pending wan-tou comparison as meeting the target', () => {
    const pending = buildModel()
    pending.scope.selectedProduct = '弹性公网IP'
    pending.overview.wanTou = {
      productKey: 'eip',
      trend: [],
      latest: { ratio: null, orders: null, complaints: 2 },
      evaluation: { target: 1, met: null, hasTarget: true },
    }
    pending.overview.productOverview[0].wanTouRatio = null
    pending.overview.productOverview[0].wanTouTargetMet = null

    const pendingHtml = renderToStaticMarkup(
      <TicketStoryView model={pending} creatingInsightId="" />,
    )
    expect(pendingHtml).toContain('待对比')
    expect(pendingHtml).not.toContain('已达标')
    expect(pendingHtml).not.toContain('未达标')

    const met = buildModel()
    met.scope.selectedProduct = '弹性公网IP'
    met.overview.wanTou = {
      productKey: 'eip',
      trend: [],
      latest: { ratio: 0.5, orders: 10000, complaints: 1 },
      evaluation: { target: 1, met: true, hasTarget: true },
    }
    met.overview.productOverview[0].wanTouRatio = 0.5
    met.overview.productOverview[0].wanTouTargetMet = true
    expect(renderToStaticMarkup(<TicketStoryView model={met} creatingInsightId="" />)).toContain('已达标')

    const missed = buildModel()
    missed.scope.selectedProduct = '弹性公网IP'
    missed.overview.wanTou = {
      productKey: 'eip',
      trend: [],
      latest: { ratio: 2, orders: 10000, complaints: 2 },
      evaluation: { target: 1, met: false, hasTarget: true },
    }
    missed.overview.productOverview[0].wanTouRatio = 2
    missed.overview.productOverview[0].wanTouTargetMet = false
    expect(renderToStaticMarkup(<TicketStoryView model={missed} creatingInsightId="" />)).toContain('未达标')
  })

  it('shows follow-up as missing instead of a fake zero satisfaction rate', () => {
    const model = buildModel()
    model.overview.metrics.followUpCount = 0
    model.overview.metrics.unresolvedCount = 0
    model.overview.metrics.followUpTenPointRate = null

    const html = renderToStaticMarkup(
      <TicketStoryView model={model} creatingInsightId="" />,
    )

    expect(html).toContain('无回访')
    expect(html).toContain('本期没有回访样本')
    expect(html).not.toContain('10分满意率 0%')
  })

  it('falls back to ungrouped evidence when no theme is available', () => {
    const model = buildModel()
    model.impactAndEvidence.summary = {
      status: 'evidence_only',
      executiveSummary: '当前未形成稳定主题，以下为高风险信号证据。',
      focusItems: [],
    }
    model.impactAndEvidence.themeLinks = []

    const html = renderToStaticMarkup(
      <TicketStoryView model={model} creatingInsightId="" />,
    )

    expect(html).toContain('当前未形成稳定主题')
    expect(html).toContain('高风险信号证据')
  })
})
