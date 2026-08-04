import { describe, expect, it } from 'vitest'
import { buildPostUseStoryModel } from './storyModel.js'

const records = Array.from({ length: 10 }, (_, index) => ({
  id: `r${index}`,
  dataSourceType: 'post_use_rating',
  productName: '弹性公网IP',
  ratingScore: index < 4 ? 8 : 10,
  channel: 'sms',
  importMonth: '2026-06',
  rawText: index < 4 ? '功能有缺失' : '',
  customerName: `客户${index}`,
}))

describe('post-use story model', () => {
  it('builds the fixed narrative hierarchy from one model', () => {
    const model = buildPostUseStoryModel({
      records,
      allRecords: records,
      visits: [{ id: 'v1', importMonth: '2026-06', productName: '弹性公网IP', userInfo: '客户0', feedbackSummary: '功能有缺失', internalConclusion: '需求接纳' }],
      productNames: ['弹性公网IP'],
      focusNames: ['弹性公网IP'],
      actions: [],
      period: { id: 'period:month:2026-06', label: '2026年6月', endDate: '2026-06-30', granularity: 'month', anchorYear: 2026 },
    })

    expect(Object.keys(model)).toEqual([
      'scope', 'conclusions', 'metrics', 'productOverview', 'trendsAndChanges',
      'drivers', 'actionsAndRecovery', 'quality', 'scoredRows', 'callbackRecommendations', 'insightBundle',
    ])
    expect(model.conclusions.map((item) => item.key)).toEqual(['overall', 'risk', 'change', 'action'])
    expect(model.productOverview[0]).toMatchObject({
      productName: '弹性公网IP',
      sampleSize: 10,
      avgScore: 9.2,
      nonTenCount: 4,
      visitEvidenceCount: 1,
      state: '重点改善',
    })
    expect(model.metrics.external.yunwang.avgScore).toBe(9.2)
    expect(model.metrics.monthlyScoreTable[0]).toMatchObject({
      productName: '弹性公网IP',
      sampleSize: 10,
      avgScore: 9.2,
    })
    expect(model.scope.productCount).toBe(1)
    expect(model.metrics.nonTenDistributionProducts).toEqual(['弹性公网IP'])
    expect(model.metrics.scoreDistribution['弹性公网IP'].sampleSize).toBe(10)
    expect(model.drivers.needs[0].visitEvidenceCount).toBe(1)
  })

  it('keeps visit evidence out of score and priority calculations', () => {
    const withoutVisits = buildPostUseStoryModel({ records, allRecords: records, productNames: ['弹性公网IP'] })
    const withVisits = buildPostUseStoryModel({
      records,
      allRecords: records,
      productNames: ['弹性公网IP'],
      visits: [{ id: 'v1', productName: '弹性公网IP', feedbackSummary: '功能有缺失' }],
    })
    expect(withVisits.metrics.internalExperience).toEqual(withoutVisits.metrics.internalExperience)
    expect(withVisits.drivers.needs[0].priorityScore).toBe(withoutVisits.drivers.needs[0].priorityScore)
    expect(withVisits.drivers.needs[0].visitEvidenceCount).toBe(1)
  })

  it('surfaces small-sample extreme low scores as critical in overview and actions', () => {
    const smallSampleRecords = [
      {
        id: 'r-low',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 3,
        channel: 'sms',
        importMonth: '2026-06',
        rawText: '配置复杂难以上手',
        customerName: '客户A',
      },
      {
        id: 'r-ok1',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 10,
        channel: 'sms',
        importMonth: '2026-06',
        rawText: '',
        customerName: '客户B',
      },
      {
        id: 'r-ok2',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 10,
        channel: 'sms',
        importMonth: '2026-06',
        rawText: '',
        customerName: '客户C',
      },
    ]
    const model = buildPostUseStoryModel({
      records: smallSampleRecords,
      allRecords: smallSampleRecords,
      productNames: ['弹性公网IP'],
    })
    expect(model.productOverview[0]).toMatchObject({
      sampleSize: 3,
      minScore: 3,
      hasCriticalLowScore: true,
      state: '重点改善',
      stateCode: 'critical',
    })
    expect(model.actionsAndRecovery.triggerGroups[0]).toMatchObject({
      productName: '弹性公网IP',
      priority: 'P0',
    })
    expect(model.actionsAndRecovery.triggerGroups[0].criticalLowScoreSignal?.type).toBe(
      'experience_critical_low_score',
    )
  })

  it('reports unclassified needs as quality evidence without creating insights or actions', () => {
    const unclassifiedRecords = records.map((record, index) => index === 0
      ? { ...record, rawText: '希望可以一键完成整个配置流程' }
      : record)
    const model = buildPostUseStoryModel({
      records: unclassifiedRecords,
      allRecords: unclassifiedRecords,
      productNames: ['弹性公网IP'],
    })
    expect(model.drivers.unclassifiedNeeds).toHaveLength(1)
    expect(model.drivers.needs.some((need) => need.need === '待归类需求')).toBe(false)
    expect(model.trendsAndChanges.changes.some((change) => change.issue === '待归类需求')).toBe(false)
    expect(model.actionsAndRecovery.rows.some((action) => action.title.includes('待归类需求'))).toBe(false)
    expect(model.quality.counts.unclassifiedNeed).toBe(1)
    expect(model.quality.anomalies).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: 'unclassified_need', productName: '弹性公网IP' }),
    ]))
  })

  it('only keeps post-use action items in actions and recovery modules', () => {
    const model = buildPostUseStoryModel({
      records,
      allRecords: records,
      productNames: ['弹性公网IP'],
      actions: [
        {
          id: 'a-post-use',
          productName: '弹性公网IP',
          content: '用后即评举措',
          status: 'completed',
          linkedDataSources: ['post_use_rating'],
          triggerMetric: { period: '2026-05', value: 8.2, baseline: 9, unit: '分' },
        },
        {
          id: 'a-complaint',
          productName: '弹性公网IP',
          content: '投诉举措',
          status: 'completed',
          linkedDataSources: ['complaint_ticket'],
          triggerMetric: { period: '2026-05', value: 8.2, baseline: 9, unit: '分' },
        },
      ],
      period: { id: 'period:month:2026-06', label: '2026年6月', endDate: '2026-06-30', granularity: 'month', anchorYear: 2026 },
    })

    expect(model.actionsAndRecovery.rows.map((item) => item.id)).toContain('a-post-use')
    expect(model.actionsAndRecovery.rows.map((item) => item.id)).not.toContain('a-complaint')
    expect(model.actionsAndRecovery.recoveryRows.map((item) => item.id)).toEqual(['a-post-use'])
  })

  it('keeps theme recommendations in action rows and product warnings in trigger groups', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'r1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 8,
          channel: 'sms',
          importMonth: '2026-06',
          rawText: '功能有缺失',
          customerName: '客户A',
        },
        {
          id: 'r2',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 6,
          channel: 'callback',
          importMonth: '2026-06',
          lowScoreReason: '流程复杂',
          rawText: '功能有缺失',
          customerName: '客户B',
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
    })
    expect(model.actionsAndRecovery.rows.every((row) => row.signal?.type === 'aggregated_need' || !row.signal)).toBe(true)
    expect(model.actionsAndRecovery.triggerGroups.some((item) => item.callbackNonTenCount > 0)).toBe(true)
  })

  it('builds callback recommendations only for key customers with score below 7', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'r1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 6,
          channel: 'sms',
          importMonth: '2026-06',
          commentText: '短信原话1',
          rawText: '短信原话1',
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-03T10:00:00.000Z',
        },
        {
          id: 'r2',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 5,
          channel: 'console',
          importMonth: '2026-06',
          commentText: '控制台原话2',
          rawText: '控制台原话2',
          lowScoreReason: '功能有缺失',
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-05T10:00:00.000Z',
        },
        {
          id: 'r3',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 7,
          channel: 'sms',
          importMonth: '2026-06',
          commentText: '7分不应命中',
          rawText: '7分不应命中',
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-06T10:00:00.000Z',
        },
        {
          id: 'r4',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 4,
          channel: 'sms',
          importMonth: '2026-06',
          commentText: '非重点客户',
          rawText: '非重点客户',
          customerName: '普通客户',
          customerCode: 'C2',
          createdAt: '2026-06-07T10:00:00.000Z',
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
      settings: { postUseKeyCustomers: ['中国铁塔'] },
    })

    expect(model.callbackRecommendations).toHaveLength(1)
    expect(model.callbackRecommendations[0]).toMatchObject({
      customerName: '中国铁塔某省公司',
      productName: '弹性公网IP',
      lowScoreLt7Count: 2,
      scoreBreakdown: '6分1次；5分1次',
      quoteCount: 2,
      reasonCount: 1,
      completed: false,
      isKeyCustomer: true,
    })
    expect(model.callbackRecommendations[0].quotes).toEqual(['控制台原话2', '短信原话1'])
    expect(model.callbackRecommendations[0].reasons).toEqual(['功能有缺失'])
  })

  it('marks callback recommendation completed when attached customer visit exists', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'r1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 4,
          channel: 'sms',
          importMonth: '2026-06',
          commentText: '短信原话1',
          rawText: '短信原话1',
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-03T10:00:00.000Z',
          customerVisit: { visitMonth: '2026-06' },
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
      settings: { postUseKeyCustomers: ['中国铁塔'] },
    })

    expect(model.callbackRecommendations[0]?.completed).toBe(true)
  })
})
