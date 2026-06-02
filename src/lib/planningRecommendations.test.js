import { describe, expect, it } from 'vitest'
import { randomId } from './randomId.js'
import {
  buildFeedbacksLinkForRecommendation,
  buildPlanningAnalysisLink,
  buildPlanningRecommendations,
  buildRecommendationEvidenceBundle,
  buildGenerationSelectedReason,
  computeRecommendationEvidenceStrength,
  compareEvidenceStrength,
  computeMaxPlanningRecommendations,
  targetRecommendationCountForProduct,
  collectActionItemsFromRecords,
  collectMergedOptimizationDetails,
  collectRecommendationProductOptions,
  dedupeRecommendationsSemantically,
  listProductsForPlanningCoverage,
  selectDiversePlanningRecommendations,
  filterRecommendationsByProduct,
  formatRecommendationForExport,
  limitPlanningRecommendations,
  mergeRecommendations,
  pickEvidenceRecords,
  recommendationMatchesProduct,
  recommendationsSimilar,
} from './planningRecommendations.js'

function makeRecord(overrides = {}) {
  return {
    id: randomId(),
    ticketId: `WO-${Math.random().toString(36).slice(2, 8)}`,
    source: '工单',
    rawText: 'test',
    createdAt: '2025-06-15T10:00:00Z',
    importMonth: '2025-06',
    dataSourceType: 'complaint_ticket',
    product: '弹性公网 IP',
    problemType: '公网访问不通',
    journeyL1: '业务使用与连通',
    journeyL2: '公网访问不通',
    sentiment: 'negative',
    rootCause: '安全组未放行导致无法访问',
    ...overrides,
  }
}

describe('planningRecommendations', () => {
  it('pickEvidenceRecords returns ticket ids from clustered records', () => {
    const records = [
      makeRecord({ ticketId: 'T-001', rootCause: '安全组未放行' }),
      makeRecord({ ticketId: 'T-002', rootCause: '安全组未放行' }),
      makeRecord({ ticketId: 'T-003', rootCause: '路由配置错误' }),
    ]
    const { ticketIds } = pickEvidenceRecords(records, 5)
    expect(ticketIds.length).toBeGreaterThanOrEqual(2)
    expect(ticketIds).toContain('T-001')
  })

  it('collectMergedOptimizationDetails merges playbook and ticket action items', () => {
    const records = [
      makeRecord({ rootCause: '安全组未放行导致无法访问' }),
      makeRecord({ id: randomId(), rootCause: '安全组未放行导致无法访问' }),
      makeRecord({ id: randomId(), rootCause: '路由配置错误' }),
    ]
    const details = collectMergedOptimizationDetails(records, {
      l1: '业务使用与连通',
      l2: '公网访问不通',
    })
    expect(details.length).toBeGreaterThanOrEqual(2)
    expect(details.some((d) => d.includes('连通性诊断'))).toBe(true)
  })

  it('collectActionItemsFromRecords prefers manualReviewOptimization', () => {
    const items = collectActionItemsFromRecords(
      [
        makeRecord({
          manualReviewOptimization: '建立端口不通类工单自动化诊断脚本，首响自动输出拦截报告。',
          optimizationProduct: '旧自动建议不应采纳。',
        }),
      ],
      5,
    )
    expect(items.some((i) => i.text.includes('自动化诊断'))).toBe(true)
    expect(items.some((i) => i.text.includes('旧自动建议'))).toBe(false)
  })

  it('buildPlanningRecommendations includes journey playbook when no ticket suggestions', () => {
    const records = [
      makeRecord({ rootCause: '安全组未放行导致无法访问' }),
      makeRecord({ id: randomId(), rootCause: '安全组未放行导致无法访问' }),
      makeRecord({ id: randomId(), rootCause: '安全组未放行导致无法访问' }),
    ]
    const recs = buildPlanningRecommendations({
      ticketRecords: records,
      mergedJourney: [
        {
          l1: '业务使用与连通',
          count: 3,
          children: [{ l2: '公网访问不通', count: 3 }],
        },
      ],
      topProblemTypes: [{ name: '公网访问不通', count: 3 }],
      sampleSize: 3,
    })
    expect(recs.length).toBeGreaterThan(0)
    expect(
      recs.some((r) => r.details?.some((d) => d.includes('连通性诊断'))),
    ).toBe(true)
  })

  it('buildPlanningRecommendations produces structured items with summary and details', () => {
    const ticketRecords = [
      makeRecord({
        optimizationSuggestion:
          '控制台增加连通性一键诊断，依次检查安全组、ACL、路由与白名单并输出平台/客户侧结论。',
      }),
      makeRecord({
        id: randomId(),
        ticketId: 'T-002',
        optimizationSuggestion:
          '控制台增加连通性一键诊断，依次检查安全组、ACL、路由与白名单并输出平台/客户侧结论。',
      }),
      makeRecord({ id: randomId(), ticketId: 'T-003' }),
    ]
    const mergedJourney = [
      {
        l1: '业务使用与连通',
        count: 3,
        children: [{ l2: '公网访问不通', count: 3 }],
      },
    ]
    const recs = buildPlanningRecommendations({
      ticketRecords,
      mergedJourney,
      topProblemTypes: [{ name: '公网访问不通', count: 3 }],
      sampleSize: 3,
    })
    expect(recs.length).toBeGreaterThan(0)
    expect(recs.length).toBeLessThanOrEqual(10)
    const first = recs[0]
    expect(first.summary).toBeTruthy()
    expect(first.summary).toMatch(/建议|完善|优化|诊断|控制台/)
    expect(first.summary).not.toMatch(/\d+\s*单（占/)
    expect(first.text).toBe(first.summary)
    expect(first.details?.length).toBeGreaterThan(0)
    expect(first.evidenceTicketIds?.length).toBeGreaterThan(0)
    expect(first.details?.some((d) => d.includes('连通性') || d.includes('安全组'))).toBe(true)
  })

  it('collectActionItemsFromRecords prioritizes manual review and filters generic text', () => {
    const items = collectActionItemsFromRecords([
      makeRecord({
        manualReviewAction: '在控制台绑定流程增加 ENI 状态预检，失败时给出具体缺失权限项。',
        optimizationSuggestion: '持续关注用户体验，纳入规划。',
      }),
    ])
    expect(items).toHaveLength(1)
    expect(items[0].source).toBe('人工复核举措')
    expect(items[0].text).toMatch(/ENI/)
  })

  it('buildPlanningRecommendations skips generic-only journey hotspots without playbook', () => {
    const recs = buildPlanningRecommendations({
      ticketRecords: [
        makeRecord({ rootCause: '待分析', journeyL2: '未知环节' }),
        makeRecord({ id: randomId(), rootCause: '待分析', journeyL2: '未知环节' }),
      ],
      mergedJourney: [
        {
          l1: '业务使用与连通',
          count: 2,
          children: [{ l2: '未知环节', count: 2 }],
        },
      ],
      topProblemTypes: [],
      sampleSize: 2,
    })
    expect(recs).toHaveLength(0)
  })

  it('dedupeRecommendationsSemantically merges same journey axis duplicates', () => {
    const a = {
      id: 'a',
      priority: 'high',
      category: 'product',
      text: '在公网访问不通环节补齐自助排查能力',
      summary: '在「业务使用与连通 → 公网访问不通」环节补齐自助排查与根因闭环能力。',
      details: ['建立连通性诊断工具', '固化 playbook'],
      scope: { journeyL1: '业务使用与连通', journeyL2: '公网访问不通', problemType: '公网访问不通' },
      signalType: 'journey_hotspot',
    }
    const b = {
      id: 'b',
      priority: 'medium',
      category: 'product',
      text: '在公网访问不通环节补齐自助排查能力（副本）',
      summary: '在「业务使用与连通 → 公网访问不通」环节补齐自助排查与根因闭环能力。',
      details: ['梳理 TOP 根因清单', '跟踪类型占比'],
      scope: { journeyL1: '业务使用与连通', journeyL2: '公网访问不通' },
      signalType: 'journey_hotspot',
    }
    expect(recommendationsSimilar(a, b)).toBe(true)
    const merged = dedupeRecommendationsSemantically([a, b])
    expect(merged).toHaveLength(1)
    expect(merged[0].details?.length).toBeGreaterThan(2)
  })

  it('mergeRecommendations unions evidence ticket ids', () => {
    const merged = mergeRecommendations(
      {
        id: '1',
        priority: 'high',
        category: 'product',
        text: 's1',
        summary: 's1',
        evidenceTicketIds: ['T-1'],
        evidenceRecordIds: ['r1'],
      },
      {
        id: '2',
        priority: 'medium',
        category: 'product',
        text: 's2',
        summary: 's2',
        evidenceTicketIds: ['T-2'],
        evidenceRecordIds: ['r2'],
      },
    )
    expect(merged.evidenceTicketIds).toEqual(['T-1', 'T-2'])
  })

  it('buildFeedbacksLinkForRecommendation uses ticketIds when evidence present', () => {
    const href = buildFeedbacksLinkForRecommendation(
      {
        id: 'x',
        priority: 'high',
        category: 'product',
        text: 's',
        summary: 's',
        scope: { product: '云专线', problemType: '链路故障', journeyL1: '业务使用与连通' },
        evidenceTicketIds: ['WO-123', 'WO-456'],
      },
      { month: '2025-06' },
    )
    expect(href).toContain('/feedbacks?')
    expect(href).toContain('month=2025-06')
    expect(href).toContain('ticketIds=WO-123%2CWO-456')
    expect(href).not.toContain('product=')
    expect(href).not.toContain('problemType=')
    expect(href).not.toContain('source=complaint_ticket')
  })

  it('buildFeedbacksLinkForRecommendation derives scope when no ticket ids', () => {
    const href = buildFeedbacksLinkForRecommendation(
      {
        id: 'x',
        priority: 'high',
        category: 'product',
        text: 's',
        summary: 's',
        scope: { product: '云专线' },
        evidenceTicketIds: [],
      },
      {
        month: '2025-06',
        evidenceRecords: [
          { ...makeRecord({ product: '云专线', dataSourceType: 'consultation_ticket' }), ticketId: '' },
          {
            ...makeRecord({
              id: randomId(),
              dataSourceType: 'consultation_ticket',
              product: '云专线',
            }),
            ticketId: '',
          },
        ],
      },
    )
    expect(href).toContain('source=consultation_ticket')
    expect(href).toContain('product=')
    expect(href).not.toContain('ticketIds=')
  })

  it('buildRecommendationEvidenceBundle aggregates counts and samples', () => {
    const rootCause = '安全组未放行导致无法访问'
    const records = [
      makeRecord({
        ticketId: 'T-1',
        sentiment: 'negative',
        rootCause,
        problemSummary: '公网无法访问',
      }),
      makeRecord({
        ticketId: 'T-2',
        sentiment: 'positive',
        rootCause,
        problemSummary: '端口不通',
      }),
      makeRecord({ ticketId: 'T-3', sentiment: 'negative', problemSummary: 'HTTPS 证书错误' }),
    ]
    const bundle = buildRecommendationEvidenceBundle(records, 100)
    expect(bundle.ticketCount).toBe(3)
    expect(bundle.negativeCount).toBe(2)
    expect(bundle.sharePct).toBe(3)
    expect(bundle.sampleSummaries?.length).toBeGreaterThan(0)
    expect(bundle.sampleSummaries?.[0]?.problemSummary).toMatch(/无法访问|端口/)
    expect(bundle.topRootCauses).toBeUndefined()
  })

  it('computeRecommendationEvidenceStrength reflects pool quality', () => {
    const records = Array.from({ length: 5 }, () =>
      makeRecord({ rootCause: '安全组未放行导致无法访问' }),
    )
    expect(computeRecommendationEvidenceStrength(records, false)).toBe('strong')
    expect(computeRecommendationEvidenceStrength(records.slice(0, 1), true)).toBe('weak')
    expect(compareEvidenceStrength('weak', 'strong')).toBeGreaterThan(0)
  })

  it('buildPlanningAnalysisLink targets insight analysis with scope', () => {
    const href = buildPlanningAnalysisLink({
      id: 'r1',
      priority: 'high',
      category: 'product',
      text: 'x',
      summary: 'x',
      scope: {
        product: '弹性公网 IP',
        journeyL1: '业务使用',
        journeyL2: '公网访问',
        problemType: '公网访问不通',
      },
    })
    expect(href).toContain('/workbench/analysis')
    expect(href).toContain('product=')
    expect(href).toContain('journeyL2')
    expect(href).toContain('tab=journey')
  })

  it('buildGenerationSelectedReason describes scope and signal', () => {
    const reason = buildGenerationSelectedReason({
      signalType: 'problem_type',
      scope: { product: 'ECS', problemType: '性能问题' },
      evidenceBundle: { ticketCount: 12 },
    })
    expect(reason).toContain('ECS')
    expect(reason).toContain('性能问题')
    expect(reason).toContain('12')
  })

  it('formatRecommendationForExport uses V2 section body when present', () => {
    const text = formatRecommendationForExport({
      id: 'r1',
      priority: 'high',
      category: 'product',
      text: '概述',
      summary: '在公网访问环节补齐诊断工具',
      sections: {
        executiveSummary: '在公网访问环节补齐诊断工具',
        painClusterScores: {
          priorityScore: 4,
          rank: 1,
          totalFinal: 3,
          breadthScore: 3,
          sharePct: 10,
          ticketCount: 5,
          harmScore: 3,
          maxSeverity: 4,
          p90Emotion: 2,
          sourceDistributionLines: [],
          customerTierSummary: '—',
        },
        productActions: ['新增连通性诊断'],
        verification: { metrics: ['复发率'], userValidation: '回访' },
      },
      evidenceTicketIds: ['T-001', 'T-002'],
    })
    expect(text).toMatch(/优先级评定/)
    expect(text).toMatch(/新增连通性诊断/)
    expect(text).not.toMatch(/详细意见/)
    expect(text).not.toMatch(/依据工单/)
  })

  it('buildPlanningRecommendations uses playbook for 云专线 订购开通与加急 without ticket text', () => {
    const ticketRecords = [
      makeRecord({
        product: '云专线',
        journeyL1: '开通与交付',
        journeyL2: '订购开通与加急',
        problemType: '开通加急',
        rootCause: '原因：从36.*.*.227这台云主机telnet 218.*.*.10 8880，访问速度很慢',
        optimizationSuggestion:
          '3、【目前进展及协助内容」在「订购开通与加急」建立专项修复与验收标准',
        solutionSummary: '3、【目前进展及协助内容」已协助客户加急处理',
      }),
      makeRecord({
        id: randomId(),
        product: '云专线',
        journeyL1: '开通与交付',
        journeyL2: '订购开通与加急',
        optimizationSuggestion:
          '针对根因「原因：从36.*.*.227这台云主机telnet 218.*.*.10 8880」在「公网访问不通或不稳定、丢包」建立专项修复与验收标准。',
      }),
      makeRecord({
        id: randomId(),
        product: '云专线',
        journeyL1: '开通与交付',
        journeyL2: '订购开通与加急',
      }),
    ]
    const recs = buildPlanningRecommendations({
      ticketRecords,
      mergedJourney: [
        {
          l1: '开通与交付',
          count: 3,
          children: [{ l2: '订购开通与加急', count: 3 }],
        },
      ],
      topProblemTypes: [{ name: '产品功能需求', count: 2 }],
      sampleSize: 3,
    })
    expect(recs.length).toBeGreaterThan(0)
    const rec = recs.find((r) => r.scope?.journeyL2 === '订购开通与加急') || recs[0]
    const summary = rec.summary || rec.text
    expect(summary).not.toMatch(/目前进展|telnet|36\.\*|建立专项修复与验收标准/)
    expect(summary).toMatch(/开通|加急|可观测|SLA|playbook|自助/i)
    for (const d of rec.details || []) {
      expect(d).not.toMatch(/目前进展|telnet|36\.\*|建立专项修复与验收标准/)
    }
  })

  it('buildPlanningRecommendations prefers playbook summary over ticket optimization text', () => {
    const ticketRecords = [
      makeRecord({
        optimizationSuggestion:
          '客户反馈公网访问不通，经排查为安全组未放行，已协助客户调整规则。',
      }),
      makeRecord({
        id: randomId(),
        optimizationSuggestion:
          '客户反馈公网访问不通，经排查为安全组未放行，已协助客户调整规则。',
      }),
      makeRecord({ id: randomId() }),
    ]
    const recs = buildPlanningRecommendations({
      ticketRecords,
      mergedJourney: [
        {
          l1: '业务使用与连通',
          count: 3,
          children: [{ l2: '公网访问不通', count: 3 }],
        },
      ],
      topProblemTypes: [{ name: '公网访问不通', count: 3 }],
      sampleSize: 3,
    })
    expect(recs.length).toBeGreaterThan(0)
    const summary = recs[0].summary || recs[0].text
    expect(summary).not.toMatch(/客户反馈|已协助/)
    expect(summary).toMatch(/建议|诊断|排查|playbook|控制台/i)
  })

  it('sanitizePlanningRecommendation strips stats from details', async () => {
    const { sanitizePlanningRecommendation } = await import('./planningRecommendations.js')
    const sanitized = sanitizePlanningRecommendation({
      id: 'x',
      priority: 'medium',
      category: 'product',
      text: '建议完善连通性诊断工具，缩短协查闭环。',
      summary: '建议完善连通性诊断工具，缩短协查闭环。',
      details: [
        '「公网访问不通」类问题占 30%，为该类型建设标准化排查工具。',
        '完善连通性诊断工具，覆盖安全组/ACL/路由',
      ],
    })
    expect(sanitized.details?.some((d) => /占\s*\d+%/.test(d))).toBe(false)
    expect(sanitized.details?.length).toBeGreaterThanOrEqual(1)
  })

  it('limitPlanningRecommendations caps list at 10 by priority', () => {
    const recs = Array.from({ length: 12 }, (_, i) => ({
      id: `r${i}`,
      priority: i < 2 ? 'high' : i < 6 ? 'medium' : 'low',
      category: 'product',
      text: `建议 ${i}`,
      summary: `建议 ${i}`,
    }))
    const limited = limitPlanningRecommendations(recs, 10)
    expect(limited).toHaveLength(10)
    expect(limited.filter((r) => r.priority === 'high')).toHaveLength(2)
  })

  it('collectRecommendationProductOptions and filterRecommendationsByProduct', () => {
    const feedbackByRecordId = new Map([
      ['uuid-journey', { id: 'uuid-journey', product: '弹性公网 IP' }],
      ['uuid-wan', { id: 'uuid-wan', product: '云主机' }],
    ])
    const recommendations = [
      {
        id: 'r1',
        priority: 'high',
        category: 'product',
        text: 's1',
        summary: 's1',
        scope: { journeyL1: '业务使用与连通' },
        evidenceRecordIds: ['uuid-journey'],
      },
      {
        id: 'r2',
        priority: 'medium',
        category: 'product',
        text: 's2',
        summary: 's2',
        scope: { product: '云主机' },
        evidenceRecordIds: ['uuid-wan'],
      },
    ]

    expect(collectRecommendationProductOptions(recommendations, feedbackByRecordId)).toEqual([
      '弹性公网 IP',
      '云主机',
    ])
    expect(recommendationMatchesProduct(recommendations[0], '弹性公网 IP', feedbackByRecordId)).toBe(true)
    expect(recommendationMatchesProduct(recommendations[0], '云主机', feedbackByRecordId)).toBe(false)
    expect(filterRecommendationsByProduct(recommendations, '弹性公网 IP', feedbackByRecordId)).toHaveLength(1)
    expect(filterRecommendationsByProduct(recommendations, undefined, feedbackByRecordId)).toHaveLength(2)
  })

  it('keeps distinct journey and problem type axes instead of merging by product alone', () => {
    const quota = {
      id: 'j-quota',
      priority: 'high',
      category: 'product',
      text: 's1',
      summary: '建议「弹性公网IP·权限及配额限制·配额与权限申请」：建立配额预警与权限自检工具。',
      details: ['建立配额预警与权限自检工具', '梳理 IAM 权限矩阵提示缺失项'],
      scope: {
        product: '弹性公网IP',
        journeyL1: '产品订改续',
        journeyL2: '权限及配额限制',
        problemType: '配额与权限申请',
      },
      signalType: 'journey_hotspot',
    }
    const create = {
      id: 'j-create',
      priority: 'high',
      category: 'product',
      text: 's2',
      summary: '建议「弹性公网IP·创建/申购 EIP」：开通失败时给出可操作错误码与自助重试路径。',
      details: ['开通失败时给出可操作错误码说明', '配额不足场景引导至配额申请流程'],
      scope: {
        product: '弹性公网IP',
        journeyL1: '产品订改续',
        journeyL2: '创建/申购 EIP',
      },
      signalType: 'journey_hotspot',
    }
    const feature = {
      id: 'pt-feature',
      priority: 'medium',
      category: 'product',
      text: 's3',
      summary: '建议「弹性公网IP·产品功能需求」：建立需求 intake 与排期可视化机制。',
      details: ['建立需求 intake 与排期可视化', '在控制台同步 roadmap 与交付窗口'],
      scope: { product: '弹性公网IP', problemType: '产品功能需求' },
      signalType: 'problem_type',
    }
    expect(recommendationsSimilar(quota, create)).toBe(false)
    expect(recommendationsSimilar(quota, feature)).toBe(false)
    expect(dedupeRecommendationsSemantically([quota, create, feature])).toHaveLength(3)
  })

  it('buildPlanningRecommendations emits multiple thematic axes for consultation-like volume', () => {
    /** @type {import('./types.js').FeedbackRecord[]} */
    const ticketRecords = []
    const pushMany = (count, overrides) => {
      for (let i = 0; i < count; i++) {
        ticketRecords.push(
          makeRecord({
            id: randomId(),
            ticketId: `WO-${overrides.journeyL2}-${i}`,
            dataSourceType: 'consultation_ticket',
            importMonth: '2026-04',
            product: '弹性公网IP',
            ...overrides,
          }),
        )
      }
    }
    pushMany(720, {
      journeyL1: '产品订改续',
      journeyL2: '权限及配额限制',
      problemType: '配额与权限申请',
    })
    pushMany(120, {
      journeyL1: '产品订改续',
      journeyL2: '创建/申购 EIP',
      problemType: '配额与权限申请',
    })
    pushMany(140, {
      journeyL1: '开通与上架',
      journeyL2: '产品上架与交付',
      problemType: '产品功能需求',
    })
    pushMany(80, {
      journeyL1: '业务使用与连通',
      journeyL2: '公网访问不通或不稳定、丢包',
      problemType: '可用性/连通性故障',
    })
    pushMany(60, {
      journeyL1: '产品订改续',
      journeyL2: '带宽升降配',
      problemType: '配置与操作',
    })
    pushMany(40, {
      journeyL1: '认知与选型',
      journeyL2: '计费模式咨询',
      problemType: '计费与账单',
    })

    const mergedJourney = [
      { l1: '产品订改续', count: 900, children: [{ l2: '权限及配额限制', count: 720 }, { l2: '创建/申购 EIP', count: 120 }, { l2: '带宽升降配', count: 60 }] },
      { l1: '开通与上架', count: 140, children: [{ l2: '产品上架与交付', count: 140 }] },
      { l1: '业务使用与连通', count: 80, children: [{ l2: '公网访问不通或不稳定、丢包', count: 80 }] },
      { l1: '认知与选型', count: 40, children: [{ l2: '计费模式咨询', count: 40 }] },
    ]
    const topProblemTypes = [
      { name: '配额与权限申请', count: 840 },
      { name: '产品功能需求', count: 140 },
      { name: '可用性/连通性故障', count: 80 },
      { name: '配置与操作', count: 60 },
      { name: '计费与账单', count: 40 },
    ]

    const recs = buildPlanningRecommendations({
      ticketRecords,
      mergedJourney,
      topProblemTypes,
      sampleSize: ticketRecords.length,
    })

    expect(recs.length).toBeGreaterThanOrEqual(4)
    expect(recs.length).toBeLessThanOrEqual(8)
    const scopes = recs.map((r) =>
      [r.scope?.journeyL2, r.scope?.problemType].filter(Boolean).join('|'),
    )
    expect(new Set(scopes).size).toBe(recs.length)
    expect(new Set(scopes).size).toBeGreaterThanOrEqual(4)
    expect(recs.some((r) => r.scope?.journeyL2 === '创建/申购 EIP')).toBe(true)
    expect(recs.some((r) => r.scope?.problemType === '产品功能需求')).toBe(true)
  })

  it('selectDiversePlanningRecommendations ensures each product has at least one item', () => {
    const ticketRecords = [
      ...Array.from({ length: 30 }, (_, i) =>
        makeRecord({
          id: `eip-${i}`,
          product: '弹性公网IP',
          journeyL1: '产品订改续',
          journeyL2: '权限及配额限制',
          problemType: '配额与权限申请',
        }),
      ),
      ...Array.from({ length: 12 }, (_, i) =>
        makeRecord({
          id: `host-${i}`,
          product: '云主机',
          journeyL1: '业务使用与连通',
          journeyL2: '远程连接异常',
          problemType: '可用性/连通性故障',
        }),
      ),
    ]

    const candidates = [
      {
        id: '1',
        signalType: 'journey_hotspot',
        priority: 'high',
        summary: '建议「弹性公网IP·权限及配额限制」：建立配额预警与权限自检能力。',
        details: ['建立配额预警', '在创建前拦截不可达订单'],
        scope: { product: '弹性公网IP', journeyL2: '权限及配额限制', problemType: '配额与权限申请' },
      },
      {
        id: '2',
        signalType: 'problem_type',
        priority: 'high',
        summary: '建议「弹性公网IP·配额与权限申请」：建立配额预警、权限自检与申请引导一体化能力。',
        details: ['建立配额预警', '权限自检工具'],
        scope: { product: '弹性公网IP', problemType: '配额与权限申请' },
      },
      {
        id: '3',
        signalType: 'journey_hotspot',
        priority: 'medium',
        summary: '建议「云主机·远程连接异常」：完善远程连接自助排查向导与安全组预检能力。',
        details: ['上线远程连接诊断向导', '明确端口与安全组边界'],
        scope: { product: '云主机', journeyL2: '远程连接异常', problemType: '可用性/连通性故障' },
      },
    ]

    const selected = selectDiversePlanningRecommendations(candidates, ticketRecords, 10)
    const products = new Set(selected.map((r) => r.scope?.product).filter(Boolean))
    expect(products.has('弹性公网IP')).toBe(true)
    expect(products.has('云主机')).toBe(true)
    expect(selected.length).toBeLessThanOrEqual(3)
    expect(recommendationsSimilar(selected[0], selected[1])).toBe(false)
  })

  it('listProductsForPlanningCoverage returns products meeting ticket threshold', () => {
    const records = [
      ...Array.from({ length: 6 }, () => makeRecord({ product: '产品A' })),
      ...Array.from({ length: 2 }, () => makeRecord({ product: '产品B' })),
    ]
    expect(listProductsForPlanningCoverage(records)).toEqual(['产品A'])
  })

  it('targetRecommendationCountForProduct scales 3-8 for large products', () => {
    expect(targetRecommendationCountForProduct(50)).toBe(2)
    expect(targetRecommendationCountForProduct(400)).toBeGreaterThanOrEqual(3)
    expect(targetRecommendationCountForProduct(400)).toBeLessThanOrEqual(8)
    expect(targetRecommendationCountForProduct(1679)).toBe(8)
  })

  it('buildPlanningRecommendations includes 云专线 and SLB with product-scoped actions', () => {
    const ticketRecords = [
      ...Array.from({ length: 25 }, (_, i) =>
        makeRecord({
          id: `dc-${i}`,
          product: '云专线',
          journeyL1: '开通与交付',
          journeyL2: '订购开通与加急',
          problemType: '配置与操作',
          requestScene: '开通咨询',
        }),
      ),
      ...Array.from({ length: 20 }, (_, i) =>
        makeRecord({
          id: `slb-${i}`,
          product: '弹性负载均衡',
          journeyL1: '监听与转发配置',
          journeyL2: '监听与端口配置',
          problemType: '配置与操作',
          requestScene: '配置变更',
        }),
      ),
    ]
    const recs = buildPlanningRecommendations({
      ticketRecords,
      mergedJourney: [],
      topProblemTypes: [{ name: '配置与操作', count: 45 }],
      sampleSize: ticketRecords.length,
    })
    const products = new Set(recs.map((r) => r.scope?.product))
    expect(products.has('云专线')).toBe(true)
    expect(products.has('弹性负载均衡')).toBe(true)
    const slbRec = recs.find((r) => r.scope?.product === '弹性负载均衡')
    expect(slbRec?.summary).toMatch(/监听|后端|配置|向导|健康检查/i)
    const dcRec = recs.find((r) => r.scope?.product === '云专线')
    expect(dcRec?.summary).toMatch(/开通|交付|订单|链路|专线/i)
  })

  it('buildPlanningRecommendations covers multiple products in period', () => {
    const ticketRecords = [
      ...Array.from({ length: 40 }, (_, i) =>
        makeRecord({
          id: `eip-${i}`,
          product: '弹性公网IP',
          journeyL1: '产品订改续',
          journeyL2: '创建/申购 EIP',
          problemType: '配额与权限申请',
        }),
      ),
      ...Array.from({ length: 15 }, (_, i) =>
        makeRecord({
          id: `vpc-${i}`,
          product: '云专线',
          journeyL1: '开通与上架',
          journeyL2: '订购开通与加急',
          problemType: '配置与操作',
        }),
      ),
    ]
    const mergedJourney = [
      {
        l1: '产品订改续',
        count: 40,
        children: [{ l2: '创建/申购 EIP', count: 40 }],
      },
      {
        l1: '开通与上架',
        count: 15,
        children: [{ l2: '订购开通与加急', count: 15 }],
      },
    ]
    const recs = buildPlanningRecommendations({
      ticketRecords,
      mergedJourney,
      topProblemTypes: [
        { name: '配额与权限申请', count: 40 },
        { name: '配置与操作', count: 15 },
      ],
      sampleSize: ticketRecords.length,
    })
    const products = new Set(recs.map((r) => r.scope?.product).filter(Boolean))
    expect(products.has('弹性公网IP')).toBe(true)
    expect(products.has('云专线')).toBe(true)
  })
})
