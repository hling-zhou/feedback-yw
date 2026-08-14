import { describe, expect, it } from 'vitest'
import { buildPostUseStoryModel } from './storyModel.js'
import {
  MAX_REPORT_ISSUES,
  applyHtmlReportOverlay,
  buildHtmlMonthlyReportModel,
  buildYunwangScoreContext,
  draftJudgmentFromConclusions,
} from './htmlReportModel.js'

const period = {
  id: 'period:month:2026-06',
  label: '2026年6月',
  endDate: '2026-06-30',
  granularity: 'month',
  anchorYear: 2026,
}

function makeRecords() {
  return [
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `r${index}`,
      dataSourceType: 'post_use_rating',
      productName: '弹性公网IP',
      ratingScore: index < 4 ? 8 : 10,
      channel: index === 0 ? 'sms' : 'console',
      importMonth: '2026-06',
      commentText: index === 0 ? '网都上不了' : '',
      feedbackReasonTexts: index === 1 ? ['功能有缺失'] : [],
      rawText: index < 4 ? '功能有缺失' : '',
      customerName: `客户${index}`,
    })),
    {
      id: 'r-praise',
      dataSourceType: 'post_use_rating',
      productName: '弹性公网IP',
      ratingScore: 10,
      channel: 'sms',
      importMonth: '2026-06',
      commentText: '用着很稳定',
      customerName: '客户好评',
    },
  ]
}

describe('html monthly report model', () => {
  it('drafts judgment from story conclusions and names issue products', () => {
    const draft = draftJudgmentFromConclusions(
      [
        { label: '整体状态', value: '存在重点改善产品', detail: '体验均分 9.2，有效样本 10' },
        { label: '首要风险', value: '弹性公网IP', detail: '均分 9.2' },
      ],
      [{ productName: '弹性公网IP' }],
    )
    expect(draft).toContain('整体状态：存在重点改善产品')
    expect(draft).toContain('首要风险：弹性公网IP')
    expect(draft).toContain('下文将分别说明：弹性公网IP。')
  })

  it('locks KPI numbers from the shared monthly preview model and prefers quotes', () => {
    const records = makeRecords()
    const storyModel = buildPostUseStoryModel({
      records,
      allRecords: records,
      productNames: ['弹性公网IP'],
      focusNames: ['弹性公网IP'],
      actions: [],
      period,
    })
    const model = buildHtmlMonthlyReportModel({
      reportMonth: '2026-06',
      storyModel,
      records,
    })
    expect(model.kpis.avgScore).toBe(storyModel.metrics.external.yunwang.avgScore)
    expect(model.kpis.totalSample).toBe(storyModel.metrics.external.yunwang.totalSample)
    expect(model.kpis.vsCompanyLabel).toBe('与公司均分持平')
    expect(model.kpis.momLabel).toBe('暂无上月对比')
    expect(model.issues[0].productName).toBe('弹性公网IP')
    expect(model.issues[0].evidence.quotes.map((item) => item.text)).toEqual(['网都上不了'])
    expect(model.issues[0].evidence.quotes[0].polarity).toBe('negative')
    expect(model.issues[0].evidence.positiveQuotes.map((item) => item.text)).toEqual(['用着很稳定'])
    expect(model.voice).toMatchObject({ positiveCount: 1, negativeCount: expect.any(Number) })
    expect(model.featuredVoice.positive[0].text).toBe('用着很稳定')
    expect(model.featuredVoice.negative[0].text).toBe('网都上不了')
    expect(model.charts.productScores[0].productName).toBe('弹性公网IP')
    expect(model.charts.scoreTrend).toBeDefined()
    expect(model.judgment).toContain('客户声音')
    expect(model.quoteRegistry.some((item) => item.text === '网都上不了')).toBe(true)
    expect(model.quoteRegistry.every((item) => item.text !== '不满原因')).toBe(true)
    expect(model.issues.length).toBeLessThanOrEqual(MAX_REPORT_ISSUES)
    expect(model.judgment).toContain('弹性公网IP')
  })

  it('puts 10-point quotes with negative wording into negative voice', () => {
    const records = [
      ...makeRecords(),
      {
        id: 'r-ten-neg',
        dataSourceType: 'post_use_rating',
        productName: '弹性公网IP',
        ratingScore: 10,
        channel: 'sms',
        importMonth: '2026-06',
        commentText: '给了满分但还是太卡了',
        customerName: '客户十负',
      },
    ]
    const storyModel = buildPostUseStoryModel({
      records,
      allRecords: records,
      productNames: ['弹性公网IP'],
      period,
    })
    const model = buildHtmlMonthlyReportModel({
      reportMonth: '2026-06',
      storyModel,
      records,
    })
    expect(model.quoteRegistry.find((item) => item.text === '给了满分但还是太卡了')?.polarity).toBe('negative')
    expect(model.featuredVoice.positive.map((item) => item.text)).toContain('用着很稳定')
    expect(model.featuredVoice.positive.map((item) => item.text)).not.toContain('给了满分但还是太卡了')
    expect(model.featuredVoice.negative.map((item) => item.text)).toContain('给了满分但还是太卡了')
  })

  it('applies saved narratives without copying table numbers into the overlay', () => {
    const records = makeRecords()
    const storyModel = buildPostUseStoryModel({
      records,
      allRecords: records,
      productNames: ['弹性公网IP'],
      period,
    })
    const overlay = {
      month: '2026-06',
      dataFingerprint: 'stale',
      hiddenSectionIds: ['appendix'],
      printAppendix: true,
      narratives: {
        judgment: '人工总判断',
        issues: {
          'product:弹性公网IP': { conclusion: '人工结论', action: '人工动作' },
        },
        todoNote: '先办回访',
      },
    }
    const model = applyHtmlReportOverlay(
      buildHtmlMonthlyReportModel({ reportMonth: '2026-06', storyModel, records }),
      overlay,
    )
    expect(model.judgment).toBe('人工总判断')
    expect(model.issues[0].conclusion).toBe('人工结论')
    expect(model.issues[0].action).toBe('人工动作')
    expect(model.todoNote).toBe('先办回访')
    expect(model.hiddenSectionIds).toEqual(['appendix'])
    expect(model.printAppendix).toBe(true)
    expect(model.tablesRefreshed).toBe(true)
    expect(overlay.narratives.avgScore).toBeUndefined()
  })

  it('compares 云网均分 with company average and previous month', () => {
    expect(buildYunwangScoreContext({
      avgScore: 9.8,
      companyAvg: 9.6,
      companySample: 20,
      previousAvg: 9.9,
      previousSample: 18,
    })).toMatchObject({
      vsCompanyLabel: '高于公司均分 0.2',
      vsCompanyTone: 'up',
      momLabel: '较上月低 0.1',
      momTone: 'down',
    })
    expect(buildYunwangScoreContext({
      avgScore: 9.5,
      companyAvg: 9.5,
      companySample: 10,
    })).toMatchObject({
      vsCompanyLabel: '与公司均分持平',
      momLabel: '暂无上月对比',
    })

    const current = makeRecords()
    const previous = Array.from({ length: 10 }, (_, index) => ({
      id: `prev-${index}`,
      dataSourceType: 'post_use_rating',
      productName: '弹性公网IP',
      ratingScore: 8,
      channel: 'sms',
      importMonth: '2026-05',
    }))
    const companyExtra = {
      id: 'company-low',
      dataSourceType: 'post_use_rating',
      productName: '云主机 ECS',
      ratingScore: 1,
      channel: 'sms',
      importMonth: '2026-06',
    }
    const storyModel = buildPostUseStoryModel({
      records: current,
      allRecords: [...previous, ...current],
      companyRecords: [...current, companyExtra],
      productNames: ['弹性公网IP'],
      period,
    })
    const model = buildHtmlMonthlyReportModel({
      reportMonth: '2026-06',
      storyModel,
      records: current,
      allRecords: [...previous, ...current],
      productNames: ['弹性公网IP'],
    })
    expect(model.kpis.vsCompanyLabel).toMatch(/^高于公司均分 /)
    expect(model.kpis.momLabel).toMatch(/^较上月高 /)
    expect(model.kpis.previousAvg).toBe(8)
    expect(model.kpis.companyAvg).toBe(storyModel.metrics.external.company.avgScore)
  })
})
