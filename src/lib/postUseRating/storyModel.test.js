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
      'drivers', 'actionsAndRecovery', 'quality', 'scoredRows', 'callbackRecommendations', 'callbackNonTenRecords', 'insightBundle',
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

  it('builds callback recommendations for key or high-frequency console low-score customers', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'r1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 6,
          channel: 'console',
          importMonth: '2026-06',
          commentText: '控制台原话1',
          rawText: '控制台原话1',
          lowScoreReason: '功能有缺失',
          feedbackReasonTexts: ['满意原因A', '建议A'],
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-03T10:00:00.000Z',
          surveyName: '旧问卷',
          touchpointPageName: '旧页面',
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
          feedbackReasonTexts: ['满意原因B', '建议B'],
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-05T10:00:00.000Z',
          surveyName: '控制台用后即评',
          touchpointPageName: '弹性公网IP详情页',
        },
        {
          id: 'r3',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 4,
          channel: 'console',
          importMonth: '2026-06',
          commentText: '普通客户原话1',
          rawText: '普通客户原话1',
          lowScoreReason: '流程复杂',
          feedbackReasonTexts: ['满意原因C'],
          customerName: '普通客户',
          customerCode: 'C2',
          createdAt: '2026-06-06T10:00:00.000Z',
        },
        {
          id: 'r4',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 5,
          channel: 'console',
          importMonth: '2026-06',
          commentText: '普通客户原话2',
          rawText: '普通客户原话2',
          lowScoreReason: '流程复杂',
          feedbackReasonTexts: ['满意原因D', '建议D'],
          customerName: '普通客户',
          customerCode: 'C2',
          createdAt: '2026-06-07T10:00:00.000Z',
        },
        {
          id: 'r5',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 4,
          channel: 'sms',
          importMonth: '2026-06',
          commentText: '短信不应命中',
          rawText: '短信不应命中',
          customerName: '普通客户',
          customerCode: 'C2',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        {
          id: 'r6',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          channel: 'option',
          importMonth: '2026-06',
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-09T10:00:00.000Z',
          surveyName: '选项类问卷',
          touchpointPageName: '选项类触点页',
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
      settings: { postUseKeyCustomers: ['中国铁塔'] },
    })

    expect(model.callbackRecommendations).toHaveLength(2)
    expect(model.callbackRecommendations[0]).toMatchObject({
      customerName: '中国铁塔某省公司',
      productName: '弹性公网IP',
      lowScoreLt7Count: 2,
      scoreBreakdown: '旧问卷*6分*1次；控制台用后即评*5分*1次',
      quoteCount: 2,
      reasonCount: 2,
      triggerType: '重点客户；高频低分客户',
      completed: false,
      isKeyCustomer: true,
      isHighFrequency: true,
    })
    expect(model.callbackRecommendations[0].quotes).toEqual(['控制台原话2', '控制台原话1'])
    expect(model.callbackRecommendations[0].reasons).toEqual(['功能有缺失', '功能有缺失'])
    expect(model.callbackRecommendations[0].feedbackReasons).toEqual(['满意原因B', '建议B', '满意原因A', '建议A'])
    expect(model.callbackRecommendations[0].quoteSummary).toBe('控制台原话2（1）；控制台原话1（1）')
    expect(model.callbackRecommendations[0].reasonSummary).toBe('功能有缺失（2）')
    expect(model.callbackRecommendations[0].feedbackReasonSummary).toBe('满意原因B（1）；建议B（1）；满意原因A（1）；建议A（1）')
    expect(model.callbackRecommendations[0].latestSurveyName).toBe('选项类问卷')
    expect(model.callbackRecommendations[0].latestTouchpointPageName).toBe('选项类触点页')
    expect(model.callbackRecommendations[0].channels).toEqual(['官网评分类', '选项类'])
    expect(model.callbackRecommendations[0].recommendedReason).toContain('命中重点客户名单')
    expect(model.callbackRecommendations[0].recommendedReason).toContain('同一客户低分记录达到2次及以上')

    expect(model.callbackRecommendations[1]).toMatchObject({
      customerName: '普通客户',
      productName: '弹性公网IP',
      lowScoreLt7Count: 2,
      scoreBreakdown: '未填写问卷名*5分*1次；未填写问卷名*4分*1次',
      quoteCount: 2,
      reasonCount: 2,
      triggerType: '高频低分客户',
      completed: false,
      isKeyCustomer: false,
      isHighFrequency: true,
    })
    expect(model.callbackRecommendations[1].quotes).toEqual(['普通客户原话2', '普通客户原话1'])
    expect(model.callbackRecommendations[1].reasons).toEqual(['流程复杂', '流程复杂'])
    expect(model.callbackRecommendations[1].quoteSummary).toBe('普通客户原话2（1）；普通客户原话1（1）')
    expect(model.callbackRecommendations[1].reasonSummary).toBe('流程复杂（2）')
    expect(model.callbackRecommendations[1].channels).toEqual(['官网评分类', '短信渠道'])
  })

  it('includes option-channel scores below 7 for yunwang products in callback recommendations', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'opt-key',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 5,
          channel: 'option',
          importMonth: '2026-06',
          commentText: '选项类原话',
          rawText: '选项类原话',
          feedbackReasonTexts: ['界面不好用', '缺乏操作指引'],
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-09T10:00:00.000Z',
          surveyName: '选项类问卷',
          touchpointPageName: '选项类触点页',
        },
        {
          id: 'opt-once',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 4,
          channel: 'option',
          importMonth: '2026-06',
          customerName: '普通客户甲',
          customerCode: 'C3',
          createdAt: '2026-06-09T11:00:00.000Z',
        },
        {
          id: 'console-once',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 6,
          channel: 'console',
          importMonth: '2026-06',
          customerName: '普通客户乙',
          customerCode: 'C4',
          createdAt: '2026-06-08T10:00:00.000Z',
        },
        {
          id: 'opt-hf',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 3,
          channel: 'option',
          importMonth: '2026-06',
          customerName: '普通客户乙',
          customerCode: 'C4',
          createdAt: '2026-06-09T12:00:00.000Z',
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
      settings: { postUseKeyCustomers: ['中国铁塔'] },
    })

    expect(model.callbackRecommendations.map((item) => item.customerName)).toEqual([
      '普通客户乙',
      '中国铁塔某省公司',
    ])
    expect(model.callbackRecommendations[0]).toMatchObject({
      customerName: '普通客户乙',
      lowScoreLt7Count: 2,
      scoreBreakdown: '未填写问卷名*6分*1次；未填写问卷名*3分*1次',
      triggerType: '高频低分客户',
      isHighFrequency: true,
      channels: ['官网评分类', '选项类'],
    })
    expect(model.callbackRecommendations[1]).toMatchObject({
      customerName: '中国铁塔某省公司',
      lowScoreLt7Count: 1,
      scoreBreakdown: '选项类问卷*5分*1次',
      triggerType: '重点客户',
      isKeyCustomer: true,
      channels: ['选项类'],
      latestSurveyName: '选项类问卷',
      latestTouchpointPageName: '选项类触点页',
      feedbackReasonSummary: '界面不好用（1）；缺乏操作指引（1）',
    })
    expect(model.metrics.internalExperience.totalSample).toBe(1)
    expect(model.metrics.internalExperience.avgScore).toBe(6)
  })

  it('uses only the three customer-answer fields for feedback reason summary', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'r1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 4,
          channel: 'console',
          importMonth: '2026-06',
          commentText: '客户原话A',
          rawText: '客户原话A',
          lowScoreReason: '低分原因A',
          feedbackReasonTexts: ['客户回答A', '客户回答B', '客户回答A'],
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
          commentText: '客户原话B',
          rawText: '客户原话B',
          lowScoreReason: '低分原因B',
          feedbackReasonTexts: ['客户回答B'],
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-05T10:00:00.000Z',
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
      settings: { postUseKeyCustomers: ['中国铁塔'] },
    })

    expect(model.callbackRecommendations[0].feedbackReasons).toEqual(['客户回答B', '客户回答A', '客户回答B'])
    expect(model.callbackRecommendations[0].feedbackReasonSummary).toBe('客户回答B（2）；客户回答A（1）')
  })

  it('builds callback non-ten trace rows from callback channel records', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'c1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 8,
          channel: 'callback',
          importMonth: '2026-06',
          customerName: '客户A',
          customerCode: 'C1',
          lowScoreReason: '处理周期长',
          originalTicketId: 'T-001',
        },
        {
          id: 'c2',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 10,
          channel: 'callback',
          importMonth: '2026-06',
          customerName: '客户B',
          customerCode: 'C2',
          lowScoreReason: '不应命中',
          originalTicketId: 'T-002',
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
    })

    expect(model.callbackNonTenRecords).toEqual([
      expect.objectContaining({
        productName: '弹性公网IP',
        originalTicketId: 'T-001',
        score: 8,
        customerName: '客户A',
        customerCode: 'C1',
        dissatisfactionReason: '处理周期长',
        importMonth: '2026-06',
        customerRequest: '',
        problemCause: '',
        itemKey: 'c:T-001',
      }),
    ])
  })

  it('joins complaint ticket customer request and reviewed root cause onto callback non-ten rows', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'c1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 8,
          channel: 'callback',
          importMonth: '2026-06',
          customerName: '客户A',
          customerCode: 'C1',
          lowScoreReason: '处理周期长',
          originalTicketId: 'T-001',
        },
      ],
      allRecords: [],
      productNames: ['弹性公网IP'],
      ticketRecords: [
        {
          ticketId: 'T-001',
          dataSourceType: 'complaint_ticket',
          customerRequest: '无法绑定弹性公网IP',
          rootCause: '自动抽取不应使用',
          rootCauseReview: '配置入口缺失',
          sourceColumns: { 问题原因: '导入列问题原因' },
        },
      ],
    })

    expect(model.callbackNonTenRecords[0]).toMatchObject({
      customerRequest: '无法绑定弹性公网IP',
      problemCause: '配置入口缺失',
    })
  })

  it('falls back to imported 问题原因 when the ticket has no manual root-cause review', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'c1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 8,
          channel: 'callback',
          importMonth: '2026-06',
          originalTicketId: 'T-002',
          customerName: '客户B',
          customerCode: 'C2',
          lowScoreReason: '未解决',
        },
      ],
      productNames: ['弹性公网IP'],
      ticketRecords: [
        {
          ticketId: 'T-002',
          dataSourceType: 'consultation_ticket',
          customerRequest: '咨询带宽扩容',
          rootCause: '自动抽取不应使用',
          sourceColumns: { 问题原因: '导入列问题原因' },
        },
      ],
    })

    expect(model.callbackNonTenRecords[0]).toMatchObject({
      customerRequest: '咨询带宽扩容',
      problemCause: '导入列问题原因',
    })
  })

  it('keeps callback recommendations downloadable after customer visits are imported', () => {
    const model = buildPostUseStoryModel({
      records: [
        {
          id: 'r1',
          dataSourceType: 'post_use_rating',
          productName: '弹性公网IP',
          ratingScore: 4,
          channel: 'console',
          importMonth: '2026-06',
          commentText: '控制台原话1',
          rawText: '控制台原话1',
          lowScoreReason: '功能有缺失',
          customerName: '中国铁塔某省公司',
          customerCode: 'C1',
          createdAt: '2026-06-03T10:00:00.000Z',
          customerVisit: { visitMonth: '2026-06' },
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
      completed: true,
    })
  })

  it('computes company mixed metrics from unscoped companyRecords', () => {
    const yunwangRecords = [
      {
        id: 'yw1',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 10,
        channel: 'sms',
      },
      {
        id: 'yw2',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 8,
        channel: 'callback',
      },
    ]
    const companyRecords = [
      ...yunwangRecords,
      {
        id: 'c1',
        dataSourceType: 'post_use_rating',
        productName: '云电脑（办公型）',
        ratingScore: 10,
        channel: 'sms',
      },
      {
        id: 'c2',
        dataSourceType: 'post_use_rating',
        productName: '云电脑（信创型）',
        ratingScore: 8,
        channel: 'console',
      },
    ]
    const model = buildPostUseStoryModel({
      records: yunwangRecords,
      allRecords: yunwangRecords,
      companyRecords,
      productNames: ['弹性公网IP'],
    })

    expect(model.metrics.internalExperience.avgScore).toBe(10)
    expect(model.metrics.internalExperience.totalSample).toBe(1)
    expect(model.metrics.external.yunwang.avgScore).toBe(9)
    expect(model.metrics.external.yunwang.totalSample).toBe(2)
    expect(model.metrics.external.company.totalSample).toBe(4)
    expect(model.metrics.external.company.avgScore).toBe(9)
    expect(model.metrics.external.company.productCount).toBe(2)
  })
})
