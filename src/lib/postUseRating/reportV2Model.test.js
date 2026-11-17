import { describe, expect, it } from 'vitest'
import { buildPostUseRatingRecord } from './buildRecords.js'
import { buildPostUseReportV2Model, reportV2QuoteCategory, validatePostUseReportV2 } from './reportV2Model.js'

const period = (kind) => kind === 'quarter'
  ? { startDate: '2026-07-01', endDate: '2026-09-30', label: '2026年Q3' }
  : { startDate: '2026-10-01', endDate: '2026-10-31', label: '2026年10月' }

function rating(id, month, score, reason, product = '弹性公网IP', channel = 'console') {
  return {
    id, dataSourceType: 'post_use_rating', importMonth: month, createdAt: `${month}-12`,
    product, productName: product, channel, ratingScore: score,
    feedbackReasonPrimary: reason, customerCode: `C-${id}`,
  }
}

describe('V2 report facts', () => {
  it('preserves the imported shared-bandwidth spec under the EIP product', () => {
    const record = buildPostUseRatingRecord({
      channel: 'console', productName: '共享带宽', score: 10,
      customerName: '', customerCode: '', answeredAt: '2026-10-12',
    }, {
      importMonth: '2026-10', importBatchId: 'batch',
      catalogProducts: [{ key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, taxonomyKey: 'eip', acceptParentName: true, specs: [{ name: '共享带宽', match: ['共享带宽'] }] }],
    })
    expect(record).toMatchObject({ product: '弹性公网IP', productName: '弹性公网IP', sourceProductName: '共享带宽' })
  })

  it('calculates report scores from records and keeps 10-point options out of actions', () => {
    const records = [
      { ...rating('low', '2026-10', 8, '功能有缺失', '共享带宽'), sourceProductName: '共享带宽' },
      rating('ten', '2026-10', 10, '', '弹性公网IP'),
      rating('option', '2026-10', 10, '购买时参数/配置选择错误', '弹性公网IP', 'option'),
      rating('praise-option', '2026-10', 10, '满意', '弹性公网IP', 'option'),
      rating('low-option', '2026-10', 1, '功能有缺失', '弹性公网IP', 'option'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      statusTrends: {
        combined: { data: [{ date: '2026-10', department: 9, company: 9, departmentRate: null }] },
        productScores: [
          { date: '2026-09', productName: '弹性公网IP', avgScore: 8.5, sampleSize: 4 },
          { date: '2026-09', productName: '共享带宽', avgScore: 10, sampleSize: 1 },
        ],
      },
    })
    expect(model.kpis).toMatchObject({ avg: 9, companyAvg: 9, totalSample: 2 })
    expect(model.products[0]).toMatchObject({ name: '弹性公网IP', sample: 2, avg: 9 })
    expect(model.quoteRegistry.find((row) => row.recordId === 'low')).toMatchObject({ productName: '弹性公网IP', sourceProductName: '共享带宽' })
    expect(model.products[0].distribution['10']).toBe(1)
    expect(model.products[0].trend.find((row) => row.month === '2026-09')).toEqual({ month: '2026-09', value: 8.8, sample: 5 })
    expect(model.satisfactionTrend.at(-1).value).toBeNull()
    expect(model.departmentTrend).toHaveLength(6)
    expect(model.companyTrend).toHaveLength(6)
    expect(model.satisfactionTrend).toHaveLength(6)
    expect(model.positiveCount).toBe(0)
    expect(reportV2QuoteCategory(model.quoteRegistry.find((row) => row.recordId === 'low-option'))).toBe('负反馈')
    const optionTheme = model.themes.find((row) => row.type === 'ten-option')
    expect(optionTheme).toBeTruthy()
    expect(model.actions.some((row) => row.id === optionTheme.key)).toBe(false)
    expect(validatePostUseReportV2(model).filter((error) => !error.includes('责任人'))).toEqual([])
  })

  it('shows an original spec from existing evidence for scored and option records', () => {
    const records = [
      { ...rating('spec-scored', '2026-10', 8, '功能有缺失'), evidence: { productName: '共享带宽' } },
      { ...rating('spec-option', '2026-10', 10, '购买时参数/配置选择错误', '弹性公网IP', 'option'), evidence: { productName: '共享带宽' } },
      rating('eip', '2026-10', 10, ''),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    expect(model.kpis).toMatchObject({ productCount: 1, totalSample: 2, avg: 9 })
    expect(model.products[0].sourceSpecRecords).toMatchObject([
      { sourceProductName: '共享带宽', countedInScore: true },
      { sourceProductName: '共享带宽', countedInScore: false },
    ])
    expect(model.quoteRegistry.find((row) => row.recordId === 'spec-scored'))
      .toMatchObject({ sourceProductName: '共享带宽', productName: '弹性公网IP' })
    expect(validatePostUseReportV2(model).filter((error) => !error.includes('责任人'))).toEqual([])
  })

  it('builds the appendix, previous visits, and follow-up count directly from records', () => {
    const records = [{ ...rating('low', '2026-10', 8, '功能有缺失'), customerName: '测试客户' }]
    const visits = [
      { id: 'previous', importMonth: '2026-09', customerName: '上期客户', productName: '弹性公网IP', visitResult: '需要优化', internalConclusion: '专项优化中' },
      { id: 'current', importMonth: '2026-10', customerName: '测试客户', customerCode: 'C-low', productName: '弹性公网IP', visitResult: '问题仍在' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits,
    })
    expect(model.customers).toMatchObject([{ customerName: '测试客户', nonTenCount: 1, products: ['弹性公网IP'] }])
    expect(model.previousVisits).toMatchObject([{ id: 'previous', category: '专项优化' }])
    expect(model.recommendedFeedbackCount).toBe(1)
    expect(model.todoRows).toEqual([])
  })

  it('uses a uniquely matched customer visit for the focus action label and fact line', () => {
    const records = [rating('monitor-low', '2026-10', 1, '不支持批量导出', '云监控')]
    const visits = [{ id: 'visit-monitor', importMonth: '2026-10', productName: '云监控', customerCode: 'C-monitor-low', visitResult: '反馈还没改，很不满意' }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records, visits,
    })
    expect(model.focus[0].actionType).toBe('回访跟进')
    expect(model.focus[0].title).toContain('客户回访明确不满')
    expect(model.focus[0].detail).toContain('同客户省代表回访')
  })

  it('labels a product-level route fault as repair while stating it is background evidence', () => {
    const records = [rating('nat-low', '2026-10', 1, '功能缺失/不完善', 'NAT网关')]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      traces: [{ id: 'trace-nat', importMonth: '2026-10', productName: 'NAT网关', recommendedReason: '订购第二个 NAT 网关后路由不通，待回访确认' }],
    })
    expect(model.focus[0].actionType).toBe('缺陷修复')
    expect(model.focus[0].detail).toContain('产品部溯源背景')
  })

  it('separates neutral remarks from the positive reply registered by the October prototype', () => {
    const records = [
      { ...rating('neutral', '2026-10', 10, ''), commentText: '退订' },
      { ...rating('thanks', '2026-10', 10, ''), commentText: '需订购其他服务，谢谢！' },
      { ...rating('unscored-neutral', '2026-10', null, '', '弹性公网IP', 'option'), commentText: '已开通新专线' },
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    expect(model.products[0].neutralCount).toBe(2)
    expect(model.positiveCount).toBe(1)
    expect(reportV2QuoteCategory(model.quoteRegistry[0])).toBe('中性备注')
    expect(reportV2QuoteCategory(model.quoteRegistry[1])).toBe('正反馈')
    expect(reportV2QuoteCategory(model.quoteRegistry.find((row) => row.recordId === 'unscored-neutral'))).toBe('中性备注')
    expect(reportV2QuoteCategory({ score: null, kind: 'quote', text: '使用完毕' })).toBe('中性备注')
    expect(model.themes).toEqual([])
  })

  it('counts one record only once per theme and marks a theme spanning a quarter', () => {
    const records = ['2026-07', '2026-08', '2026-09'].map((month, index) =>
      rating(`q-${index}`, month, 5, '功能有缺失'))
    const model = buildPostUseReportV2Model({
      reportKey: '2026-Q3', reportKind: 'quarter', reportPeriod: period('quarter'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const theme = model.themes.find((row) => row.theme === '功能有缺失')
    expect(theme).toMatchObject({ count: 3, lifecycle: '贯穿全季', priority: 'P0' })
    expect(Object.values(theme.monthCounts)).toEqual([1, 1, 1])
    expect(model.products[0].monthly.map((row) => row.sample)).toEqual([1, 1, 1])
    expect(model.departmentTrend).toHaveLength(6)
    expect(model.companyTrend).toHaveLength(6)
    expect(model.satisfactionTrend).toHaveLength(6)
    expect(model.products[0].trend).toHaveLength(14)
    expect(validatePostUseReportV2(model, Object.fromEntries(model.focus.map((row) => [row.id, { owner: '负责人' }])))).toEqual([])
  })

  it('assigns an owner only when the trace is linked to that issue', () => {
    const records = [
      rating('missing-feature', '2026-10', 5, '功能有缺失'),
      rating('slow-page', '2026-10', 5, '页面打开慢'),
    ]
    const traces = [{
      id: 'trace-feature', productName: '弹性公网IP', importMonth: '2026-10',
      customerCode: 'C-missing-feature', customerFeedback: '功能有缺失',
      assigneeName: '经办甲', recommendedReason: '核查缺失能力',
    }]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      traces,
    })
    expect(model.actions.find((row) => row.theme === '功能有缺失')).toMatchObject({ owner: '经办甲', text: '核查缺失能力' })
    expect(model.actions.find((row) => row.theme === '页面打开慢')).toMatchObject({ owner: '', text: '核查「页面打开慢」并明确处理结论' })
  })

  it('puts a dissatisfied customer first and keeps the focus across products', () => {
    const records = [
      rating('eip-a', '2026-10', 1, '功能有缺失'),
      rating('eip-b', '2026-10', 1, '功能有缺失'),
      rating('nat-a', '2026-10', 1, '功能有缺失', 'NAT网关'),
      rating('monitor-a', '2026-10', 1, '功能有缺失', '云监控'),
    ]
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
      visits: [{ productName: '云监控', importMonth: '2026-10', customerCode: 'C-monitor-a', visitResult: '客户表示还没改，挺不满意' }],
    })
    expect(model.focus.map((row) => row.productName)).toEqual(['云监控', '弹性公网IP', 'NAT网关'])
  })

  it('caps each product at five actions while retaining every focus action', () => {
    const reasons = [
      '功能有缺失', '稳定性不足故障频发', '页面打开慢', '界面布局不合理',
      '缺乏操作指引', '内容/帮助说明不易懂', '自助解决支撑不足',
    ]
    const records = reasons.map((reason, index) => rating(`action-${index}`, '2026-10', 5, reason))
    const model = buildPostUseReportV2Model({
      reportKey: '2026-10', reportKind: 'month', reportPeriod: period('month'),
      records, companyRecords: records, allRecords: records, allCompanyRecords: records,
    })
    const actions = model.actions.filter((row) => row.productName === '弹性公网IP')
    expect(actions).toHaveLength(5)
    expect(actions.some((row) => row.mergedThemeCount > 1)).toBe(true)
    expect(model.focus.every((row) => actions.some((action) => action.id === row.id))).toBe(true)
    expect(validatePostUseReportV2(model).filter((error) => !error.includes('缺少责任人'))).toEqual([])
  })
})
