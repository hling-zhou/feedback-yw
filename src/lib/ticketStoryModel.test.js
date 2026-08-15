import { describe, expect, it } from 'vitest'
import { buildTicketStoryModel, buildJourneyStages, collectOverviewJourneyRecords, pickRepresentativeCustomerRequest, CUSTOMER_REQUEST_DISPERSED } from './ticketStoryModel.js'

const record = (id, overrides = {}) => ({
  id,
  ticketId: `T-${id}`,
  dataSourceType: 'complaint_ticket',
  product: '弹性公网IP',
  importMonth: '2026-06',
  requestScene: '报障与排错',
  problemType: '可用性/连通性故障',
  journeyL1: '使用',
  journeyL2: '连通性验证',
  painPoint: '公网IP无法访问',
  sentiment: 'negative',
  ...overrides,
})

describe('ticket story model', () => {
  it('builds a complaint story with evidence-only follow-up data', () => {
    const records = [
      record('1', { followUpSatisfaction: { score: 8, problemResolved: 'unresolved' }, customerTier: '金牌' }),
      record('2'),
    ]
    const recommendations = [{
      id: 'cluster-1', stableKey: 'pcl-1', signalType: 'pain_cluster_v2', summary: '公网IP无法访问', priority: 'high',
      scope: { product: '弹性公网IP' }, evidenceRecordIds: ['1', '2'],
      sections: { painClusterScores: { ticketCount: 2, sharePct: 100, maxSeverity: 5, p90Emotion: 4, priorityScore: 4.5 } },
    }]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket', sourceLabel: '投诉工单', periodLabel: '2026年6月',
      records, trendRecords: records, trendMonths: ['2026-05', '2026-06'], recommendations,
      snapshot: { status: 'ready', pipelineVersion: 'ticket-v1', aggregates: { painPointClustering: { clusteringVersion: 'v2.0' } } },
    })
    expect(Object.keys(model)).toEqual(['scope', 'conclusions', 'overview', 'trendsAndChanges', 'drivers', 'impactAndEvidence', 'actionsAndRecovery', 'quality'])
    expect(model.overview.metrics).toMatchObject({ total: 2, negativeCount: 2, unresolvedCount: 1 })
    expect(model.drivers.clusters[0]).toMatchObject({ pain: '公网IP无法访问', priorityScore: 4.5 })
    expect(model.drivers.fallbackReferences).toEqual([])
    expect(model.impactAndEvidence.highValueCount).toBe(1)
    expect(model.drivers.journeyLayout).toBe('empty')
    expect(model.drivers.journeyStages).toEqual([])
    expect(model.drivers.journeySourceFilter).toBe('complaint')
  })

  it('uses consultation-specific opportunity metrics and omits complaint causes', () => {
    const records = [
      record('1', { dataSourceType: 'consultation_ticket', requestScene: '操作指导', problemType: '配置与操作', painPoint: '缺少配置操作指引', sentiment: 'neutral_inquiry' }),
      record('2', { dataSourceType: 'consultation_ticket', requestScene: '操作指导', problemType: '配置与操作', painPoint: '缺少配置操作指引', sentiment: 'neutral_inquiry' }),
    ]
    const model = buildTicketStoryModel({ sourceType: 'consultation_ticket', sourceLabel: '咨询工单', records, trendRecords: records, trendMonths: ['2026-06'] })
    expect(model.overview.metrics.repeatConsultationPct).toBe(100)
    expect(model.overview.metrics.selfServicePct).toBe(100)
    expect(model.overview.metrics.followUpTenPointRate).toBeNull()
    expect(model.overview.metrics.topOpportunity).toBe('文档自助')
    expect(model.overview.productOverview[0].repeatConsultationPct).toBe(100)
    expect(model.drivers.opportunities[0].name).toBe('文档自助')
    expect(model.drivers.complaintCauses).toEqual([])
    expect(model.drivers.journeySourceFilter).toBe('consultation')
    expect(model.drivers.journeyLayout).toBe('empty')
  })

  it('treats empty previous period as new problems instead of year-gap disappearances', () => {
    const records = [record('1')]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records,
      trendRecords: records,
      comparisonRecords: records,
      trendMonths: ['2026-05', '2026-06', '2026-07'],
      period: {
        id: 'period:month:2026-06',
        label: '2026年6月',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        granularity: 'month',
        anchorYear: 2026,
        anchorMonth: 6,
      },
      periodEndMonth: '2026-06',
    })
    expect(model.trendsAndChanges.changes).toEqual([
      expect.objectContaining({
        journeyL1: '使用',
        change: '新增',
        previousCount: 0,
        currentCount: 1,
        ticketIds: ['T-1'],
      }),
    ])
  })

  it('includes real ticket ids on change buckets for evidence drill-down', () => {
    const records = [record('1', { importMonth: '2026-05' }), record('2', { importMonth: '2026-06' })]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: [records[1]],
      trendRecords: records,
      comparisonRecords: records,
      trendMonths: ['2026-05', '2026-06'],
      period: {
        id: 'period:month:2026-06',
        label: '2026年6月',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        granularity: 'month',
        anchorYear: 2026,
        anchorMonth: 6,
      },
      periodEndMonth: '2026-06',
    })
    expect(model.trendsAndChanges.previousPeriodLabel).toBe('上月')
    expect(model.trendsAndChanges.currentPeriodLabel).toBe('本月')
    expect(model.trendsAndChanges.changes[0].change).toBe('持续')
    expect(model.trendsAndChanges.changes[0].journeyL1).toBe('使用')
    expect(model.trendsAndChanges.changes[0].ticketIds).toEqual(expect.arrayContaining(['T-1', 'T-2']))
  })

  it('uses quarter labels and aggregates across quarter months', () => {
    const records = [
      record('1', { importMonth: '2026-01', problemType: 'A' }),
      record('2', { importMonth: '2026-04', problemType: 'A' }),
      record('3', { importMonth: '2026-05', problemType: 'A' }),
    ]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: records.filter((item) => item.importMonth.startsWith('2026-0') && Number(item.importMonth.slice(5)) >= 4),
      comparisonRecords: records,
      trendRecords: records,
      trendMonths: ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06'],
      period: {
        id: 'period:quarter:2026-Q2',
        label: '2026年Q2',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        granularity: 'quarter',
        anchorYear: 2026,
        anchorQuarter: 2,
      },
      periodEndMonth: '2026-06',
    })
    expect(model.trendsAndChanges.previousPeriodLabel).toBe('上一季度')
    expect(model.trendsAndChanges.currentPeriodLabel).toBe('本季度')
    expect(model.trendsAndChanges.changes[0]).toMatchObject({
      journeyL1: '使用',
      previousCount: 1,
      currentCount: 2,
      change: '增长',
    })
  })

  it('computes product overview MoM delta against previous calendar month', () => {
    const records = [
      record('1', { importMonth: '2026-05' }),
      record('2', { importMonth: '2026-06' }),
      record('3', { importMonth: '2026-06' }),
    ]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: records.filter((item) => item.importMonth === '2026-06'),
      comparisonRecords: records,
      trendRecords: records,
      trendMonths: ['2026-05', '2026-06'],
      period: {
        id: 'period:month:2026-06',
        label: '2026年6月',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        granularity: 'month',
        anchorYear: 2026,
        anchorMonth: 6,
      },
      periodEndMonth: '2026-06',
    })
    expect(model.overview.productOverview[0].delta).toBe(1)
  })

  it('keeps follow-up and customer tier out of cluster priority scores', () => {
    const recommendations = [{
      id: 'cluster-1', stableKey: 'pcl-1', signalType: 'pain_cluster_v2', summary: '公网IP无法访问', priority: 'high', scope: { product: '弹性公网IP' }, evidenceRecordIds: ['1'],
      sections: { painClusterScores: { ticketCount: 1, sharePct: 100, maxSeverity: 5, p90Emotion: 4, priorityScore: 4.5 } },
    }]
    const base = buildTicketStoryModel({ sourceType: 'complaint_ticket', records: [record('1')], recommendations })
    const enriched = buildTicketStoryModel({ sourceType: 'complaint_ticket', records: [record('1', { customerTier: '金牌', followUpSatisfaction: { score: 1, problemResolved: 'unresolved' } })], recommendations })
    expect(enriched.drivers.clusters[0].priorityScore).toBe(base.drivers.clusters[0].priorityScore)
    expect(enriched.impactAndEvidence.unresolvedCount).toBe(1)
  })

  it('separates fallback references and builds stable insight ids', () => {
    const recommendations = [{
      id: 'fallback-1',
      stableKey: 'pfr-1234',
      signalType: 'journey_problem_fallback',
      summary: '控制台配置路径不清晰',
      text: '控制台配置路径不清晰',
      priority: 'low',
      scope: { product: '弹性公网IP', journeyL1: '使用', journeyL2: '连通性验证', problemType: '配置与操作' },
      evidenceRecordIds: ['1'],
      evidenceBundle: { ticketCount: 1, sharePct: 100 },
      generationMeta: { selectedReason: '按旅程×问题类型频次推断' },
    }]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: [record('1')],
      recommendations,
      actions: [{ id: 'a1', linkedInsightIds: ['ticket:complaint_ticket:pfr-1234'], status: 'pending_evaluation' }],
    })
    expect(model.drivers.clusters).toEqual([])
    expect(model.drivers.fallbackReferences).toHaveLength(1)
    expect(model.actionsAndRecovery.rows[0].insightIds).toContain('ticket:complaint_ticket:pfr-1234')
    expect(model.actionsAndRecovery.rows[0].actionStatus).toBeTruthy()
  })

  it('uses snapshot impact focus summaries when available and groups evidence by theme', () => {
    const recommendations = [{
      id: 'cluster-1',
      stableKey: 'pcl-1',
      signalType: 'pain_cluster_v2',
      summary: '公网IP无法访问',
      priority: 'high',
      scope: { product: '弹性公网IP' },
      evidenceRecordIds: ['1'],
      sections: { painClusterScores: { ticketCount: 1, sharePct: 100, maxSeverity: 5, p90Emotion: 4, priorityScore: 4.5 } },
    }]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: [record('1', { customerTier: '金牌', followUpSatisfaction: { score: 6, problemResolved: 'unresolved' } })],
      recommendations,
      selectedProduct: '弹性公网IP',
      snapshot: {
        status: 'ready',
        pipelineVersion: 'ticket-v1',
        aggregates: {
          painPointClustering: { clusteringVersion: 'v2.0' },
          impactFocusSummaries: {
            all: { summary: { status: 'empty', executiveSummary: '全部产品暂无结果', focusItems: [] }, themeLinks: [], ungroupedEvidenceRecordIds: [] },
            byProduct: {
              弹性公网IP: {
                summary: {
                  status: 'linked',
                  executiveSummary: '当前最需要重点关注公网IP无法访问。',
                  focusItems: [{ themeId: 'pcl-1', themeLabel: '公网IP无法访问', riskLevel: 'high', riskSignals: ['高价值客户', '回访未解决'], summary: '公网IP无法访问已影响高价值客户。', evidenceRecordIds: ['1'], evidenceTicketIds: ['T-1'] }],
                },
                themeLinks: [{ themeId: 'pcl-1', themeLabel: '公网IP无法访问', riskLevel: 'high', impactSignals: { highValueCount: 1, negativeCount: 1, urgentCount: 0, unresolvedCount: 1 }, evidenceRecordIds: ['1'], inferred: false }],
                ungroupedEvidenceRecordIds: ['1'],
              },
            },
          },
        },
      },
    })

    expect(model.impactAndEvidence.summary.executiveSummary).toContain('公网IP无法访问')
    expect(model.impactAndEvidence.summarySource).toBe('snapshot')
    expect(model.impactAndEvidence.themeLinks[0]).toMatchObject({
      themeId: 'pcl-1',
      records: [expect.objectContaining({ id: '1' })],
      clusterTicketIds: ['T-1'],
      ticketCount: 1,
    })
  })

  it('fills cluster ticket ids from the recommendation when a snapshot only stored the sample', () => {
    const records = [record('1'), record('2'), record('3')]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records,
      recommendations: [{
        id: 'cluster-1',
        stableKey: 'pcl-1',
        signalType: 'pain_cluster_v2',
        summary: '公网IP无法访问',
        scope: { product: '弹性公网IP' },
        evidenceRecordIds: ['1', '2', '3'],
        sections: { painClusterScores: { ticketCount: 3 } },
      }],
      snapshot: {
        status: 'ready',
        pipelineVersion: 'ticket-v1',
        aggregates: {
          impactFocusSummaries: {
            all: {
              summary: { status: 'linked', executiveSummary: '公网IP无法访问', focusItems: [] },
              themeLinks: [{
                themeId: 'pcl-1',
                themeLabel: '公网IP无法访问',
                riskLevel: 'high',
                impactSignals: { highValueCount: 0, negativeCount: 1, urgentCount: 0, unresolvedCount: 0 },
                evidenceRecordIds: ['1'],
                inferred: false,
              }],
              ungroupedEvidenceRecordIds: [],
            },
            byProduct: {},
          },
        },
      },
    })

    expect(model.impactAndEvidence.themeLinks[0].records).toHaveLength(1)
    expect(model.impactAndEvidence.themeLinks[0].clusterTicketIds).toEqual(['T-1', 'T-2', 'T-3'])
    expect(model.impactAndEvidence.themeLinks[0].ticketCount).toBe(3)
  })

  it('falls back to evidence-only impact summary when there is no theme', () => {
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: [record('1', { urgencyLevel: 'high' })],
      recommendations: [],
    })

    expect(model.impactAndEvidence.summary.status).toBe('evidence_only')
    expect(model.impactAndEvidence.themeLinks).toEqual([])
    expect(model.impactAndEvidence.records[0].id).toBe('1')
  })

  it('uses product taxonomy lifecycle order and keeps disappeared stages', () => {
    const records = [
      record('1', { importMonth: '2026-05', journeyL1: '故障与应急', journeyL2: '业务中断/不可用' }),
      record('2', { importMonth: '2026-06', journeyL1: '业务使用与连通', journeyL2: '公网访问不通' }),
      record('3', { importMonth: '2026-06', journeyL1: '业务使用与连通', journeyL2: '公网访问不通' }),
    ]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: records.filter((item) => item.importMonth === '2026-06'),
      comparisonRecords: records,
      trendRecords: records,
      selectedProduct: '弹性公网IP',
      period: {
        id: 'period:month:2026-06',
        label: '2026年6月',
        startDate: '2026-06-01',
        endDate: '2026-06-30',
        granularity: 'month',
        anchorYear: 2026,
        anchorMonth: 6,
      },
      periodEndMonth: '2026-06',
    })
    expect(model.drivers.journeyLayout).toBe('lifecycle')
    expect(model.overview.metrics.volumeDelta).toBe(1)
    expect(model.drivers.journeyStages[0].journeyL1).toBe('认知与选型')
    expect(model.drivers.journeyStages[0].empty).toBe(true)
    const operate = model.drivers.journeyStages.find((stage) => stage.journeyL1 === '业务使用与连通')
    const incident = model.drivers.journeyStages.find((stage) => stage.journeyL1 === '故障与应急')
    expect(operate).toMatchObject({
      currentCount: 2,
      previousCount: 0,
      change: '新增',
      headline: '公网访问不通',
      actionLabel: '公网访问不通',
      delta: 2,
      complaintCount: 2,
      consultationCount: 0,
      isFrictionPeak: true,
    })
    expect(incident).toMatchObject({ currentCount: 0, previousCount: 1, change: '消失' })
    expect(model.drivers.journeyChangeHighlights.map((item) => item.change)).toEqual(['新增', '消失'])
    expect(model.conclusions.find((item) => item.key === 'change')?.value).toBe('业务使用与连通')
  })

  it('splits journey volume by source filter and keeps change rows without a product', () => {
    const records = [
      record('c1', { importMonth: '2026-06', journeyL1: '业务使用与连通', journeyL2: '公网访问不通' }),
      record('c2', { importMonth: '2026-06', journeyL1: '业务使用与连通', journeyL2: '公网访问不通' }),
      record('q1', {
        importMonth: '2026-06',
        dataSourceType: 'consultation_ticket',
        journeyL1: '认知与选型',
        journeyL2: '产品与规格咨询',
        problemType: '配置与操作',
        painPoint: '规格怎么选',
        sentiment: 'neutral_inquiry',
      }),
      record('c0', { importMonth: '2026-05', journeyL1: '业务使用与连通', journeyL2: '公网访问不通' }),
    ]
    const period = {
      id: 'period:month:2026-06',
      label: '2026年6月',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      granularity: 'month',
      anchorYear: 2026,
      anchorMonth: 6,
    }
    const all = buildJourneyStages({
      currentRecords: records.filter((item) => item.importMonth === '2026-06'),
      previousRecords: records.filter((item) => item.importMonth === '2026-05'),
      hasPreviousPeriod: true,
      selectedProduct: '弹性公网IP',
      sourceFilter: 'all',
    })
    const operate = all.stages.find((stage) => stage.journeyL1 === '业务使用与连通')
    const learn = all.stages.find((stage) => stage.journeyL1 === '认知与选型')
    expect(operate).toMatchObject({
      count: 2,
      complaintCount: 2,
      consultationCount: 0,
      isFrictionPeak: true,
    })
    expect(learn).toMatchObject({ count: 1, complaintCount: 0, consultationCount: 1 })

    const consultOnly = buildJourneyStages({
      currentRecords: records.filter((item) => item.importMonth === '2026-06'),
      previousRecords: records.filter((item) => item.importMonth === '2026-05'),
      hasPreviousPeriod: true,
      selectedProduct: '弹性公网IP',
      sourceFilter: 'consultation',
    })
    expect(consultOnly.stages.find((stage) => stage.journeyL1 === '认知与选型')).toMatchObject({
      count: 1,
      consultationCount: 1,
      isFrictionPeak: true,
    })
    expect(consultOnly.stages.find((stage) => stage.journeyL1 === '业务使用与连通').count).toBe(0)

    const tied = buildJourneyStages({
      currentRecords: [
        record('a1', { journeyL1: '业务使用与连通', journeyL2: '公网访问不通' }),
        record('a2', { journeyL1: '业务使用与连通', journeyL2: '公网访问不通' }),
        record('b1', { journeyL1: '认知与选型', journeyL2: '产品与规格咨询' }),
        record('b2', { journeyL1: '认知与选型', journeyL2: '产品与规格咨询' }),
      ],
      previousRecords: [],
      hasPreviousPeriod: false,
      selectedProduct: '弹性公网IP',
      sourceFilter: 'all',
    })
    const tiedPeaks = tied.stages.filter((stage) => stage.isFrictionPeak).map((stage) => stage.journeyL1)
    expect(tiedPeaks).toEqual(['认知与选型', '业务使用与连通'])
    expect(tied.peakKeys).toEqual(['认知与选型', '业务使用与连通'])

    const noPrevious = buildJourneyStages({
      currentRecords: records.filter((item) => item.importMonth === '2026-06'),
      previousRecords: records,
      hasPreviousPeriod: false,
      selectedProduct: '弹性公网IP',
      sourceFilter: 'all',
    })
    const noPreviousOperate = noPrevious.stages.find((stage) => stage.journeyL1 === '业务使用与连通')
    expect(noPreviousOperate).toMatchObject({
      currentCount: 2,
      previousCount: 0,
      delta: null,
      change: null,
    })
    const idleStage = all.stages.find((stage) => stage.currentCount === 0 && stage.previousCount === 0)
    expect(idleStage).toMatchObject({ empty: true, delta: 0, change: null })

    const noProduct = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records: records.filter((item) => item.importMonth === '2026-06' && item.dataSourceType === 'complaint_ticket'),
      comparisonRecords: records.filter((item) => item.dataSourceType !== 'consultation_ticket'),
      trendRecords: records,
      period,
      periodEndMonth: '2026-06',
    })
    expect(noProduct.drivers.journeyLayout).toBe('empty')
    expect(noProduct.drivers.journeyStages).toEqual([])
    expect(noProduct.trendsAndChanges.changes).toEqual(expect.arrayContaining([
      expect.objectContaining({ journeyL1: '业务使用与连通', currentCount: 2, change: '增长' }),
    ]))
  })

  it('collects overview journey records from CX complaints and all consultations', () => {
    const rows = [
      record('cx', { complaintCauseL1Final: '客户体验类' }),
      record('ops', { complaintCauseL1Final: '云能问题' }),
      record('q', { dataSourceType: 'consultation_ticket', sentiment: 'neutral_inquiry' }),
      record('rating', { dataSourceType: 'post_use_rating' }),
    ]
    const collected = collectOverviewJourneyRecords(rows, {
      id: 'period:month:2026-06',
      label: '2026年6月',
      startDate: '2026-06-01',
      endDate: '2026-06-30',
      granularity: 'month',
      anchorYear: 2026,
      anchorMonth: 6,
    })
    expect(collected.map((item) => item.id).sort()).toEqual(['cx', 'q'])
    expect(collectOverviewJourneyRecords(rows, null)).toEqual([])
  })

  it('uses cluster-level pain and majority customer request instead of the first evidence ticket', () => {
    const records = [
      record('1', { customerRequest: '偶发连不上', painPoint: '公网IP无法访问' }),
      record('2', { customerRequest: '公网IP无法访问外网', painPoint: '公网IP无法访问' }),
      record('3', { customerRequest: '公网IP无法访问外网', painPoint: '公网IP无法访问' }),
    ]
    const recommendations = [{
      id: 'cluster-1',
      stableKey: 'pcl-1',
      signalType: 'pain_cluster_v2',
      summary: '公网IP无法访问（3 条工单，占该产品 100%）',
      generationMeta: { representativePain: '公网IP无法访问' },
      priority: 'high',
      scope: { product: '弹性公网IP' },
      evidenceRecordIds: ['1', '2', '3'],
      sections: { painClusterScores: { ticketCount: 3, sharePct: 100, maxSeverity: 5, p90Emotion: 4, priorityScore: 4.5 } },
    }]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records,
      recommendations,
    })
    expect(model.drivers.clusters[0].pain).toBe('公网IP无法访问')
    expect(model.drivers.clusters[0].customerRequest).toBe('公网IP无法访问外网')
    expect(model.drivers.clusters[0].ticketCount).toBe(3)
    expect(model.drivers.clusters[0]).not.toHaveProperty('rootCause')
  })

  it('uses the highest-priority formal cluster as the product primary problem', () => {
    const records = [record('1'), record('2')]
    const model = buildTicketStoryModel({
      sourceType: 'complaint_ticket',
      records,
      recommendations: [
        {
          id: 'low',
          signalType: 'pain_cluster_v2',
          summary: '次要问题',
          generationMeta: { representativePain: '次要问题' },
          priority: 'low',
          scope: { product: '弹性公网IP' },
          evidenceRecordIds: ['1'],
          sections: { painClusterScores: { ticketCount: 1, priorityScore: 2.1 } },
        },
        {
          id: 'high',
          signalType: 'pain_cluster_v2',
          summary: '首要连通故障',
          generationMeta: { representativePain: '首要连通故障' },
          priority: 'high',
          scope: { product: '弹性公网IP' },
          evidenceRecordIds: ['1', '2'],
          sections: { painClusterScores: { ticketCount: 2, priorityScore: 4.6 } },
        },
      ],
    })
    expect(model.overview.productOverview[0].primaryProblem).toBe('首要连通故障')
  })

  it('marks dispersed customer requests instead of a singleton wording', () => {
    expect(pickRepresentativeCustomerRequest([
      record('1', { customerRequest: '怎么开通' }),
      record('2', { customerRequest: '带宽如何升配' }),
      record('3', { customerRequest: '能否绑定多IP' }),
    ])).toBe(CUSTOMER_REQUEST_DISPERSED)
    expect(pickRepresentativeCustomerRequest([
      record('1', { customerRequest: '公网IP无法访问外网' }),
      record('2', { customerRequest: '公网IP无法访问外网' }),
      record('3', { customerRequest: '偶发连不上' }),
    ])).toBe('公网IP无法访问外网')
  })
})
