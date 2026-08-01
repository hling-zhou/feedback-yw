import { describe, expect, it } from 'vitest'
import { buildMonthlyReportPreviewModel } from './monthlyReportPreview.js'

describe('post-use online analysis to Word report', () => {
  it('uses the same month for visits and reuses the online insight bundle', () => {
    const model = buildMonthlyReportPreviewModel({
      reportMonth: '2026-06',
      scoredRows: [{ channel: 'sms', productName: '弹性公网IP', score: 8 }],
      productNames: ['弹性公网IP'],
      visits: [
        { id: 'may', importMonth: '2026-05', visitMonth: '2026-04' },
        {
          id: 'june',
          importMonth: '2026-06',
          visitMonth: '2026-05',
          userFeedbackText: '希望支持跨用户变更',
          userInfoDetail: '客户A',
          visitFeedbackDetail: '已完成电话回访',
          internalEvaluationDetail: '建议进入需求池',
        },
      ],
      insightBundle: {
        ruleVersion: 'pur-insight-v1',
        products: [{ productName: '弹性公网IP' }],
        sceneJourneys: [{ productName: '弹性公网IP', originalScene: '创建后', journey: '开通' }],
        needs: [{ productName: '弹性公网IP', need: '功能有缺失' }],
        customers: [{ customerName: '客户A' }],
        issueChanges: [{ issue: '功能有缺失', change: '增长' }],
      },
    })

    expect(model.visitMonth).toBe('2026-06')
    expect(model.visits.map((item) => item.id)).toEqual(['june'])
    expect(model.onlineModel.source).toBe('post_use_online_insight_bundle')
    expect(model.productExperience).toHaveLength(1)
    expect(model.sceneJourneys).toHaveLength(1)
    expect(model.needs).toHaveLength(1)
    expect(model.issueChanges[0].change).toBe('增长')
    expect(model.monthlyScoreTable[0]).toMatchObject({
      productName: '弹性公网IP',
      sampleSize: 1,
      avgScore: 8,
    })
    expect(model.scoreDistributionTable[0].productName).toBe('弹性公网IP')
    expect(model.visitsDetailed[0]).toMatchObject({
      userFeedbackText: '希望支持跨用户变更',
      userInfoDetail: '客户A',
      visitFeedbackDetail: '已完成电话回访',
      internalEvaluationDetail: '建议进入需求池',
    })
  })

  it('builds a reusable review checklist from stored learnings', () => {
    const model = buildMonthlyReportPreviewModel({
      reportMonth: '2026-06',
      scoredRows: [{ channel: 'sms', productName: '弹性公网IP', score: 8 }],
      productNames: ['弹性公网IP'],
      learnings: [
        {
          id: 'l-2.3',
          section: '2.3',
          title: '导出前复核 2.3 评分分布矩阵',
          summary: '修订版对评分分布矩阵进行了修改 1 行。',
          recommendation: '优先核查 2.3 非10分产品覆盖与 10~1 分分布矩阵。',
          hitCount: 3,
          lastSeenAt: '2026-07-31T10:00:00.000Z',
        },
        {
          id: 'l-2.1',
          section: '2.1',
          title: '导出前复核 2.1 产品总表',
          summary: '修订版对产品总表进行了修改 1 行。',
          recommendation: '优先核查 2.1 产品名、样本量、得分与投诉回访满意比。',
          hitCount: 5,
          lastSeenAt: '2026-07-30T10:00:00.000Z',
        },
      ],
    })

    expect(model.reviewChecklist).toHaveLength(2)
    expect(model.reviewChecklist[0]).toMatchObject({
      section: '2.1',
      sectionLabel: '2.1 整体得分情况',
      hitCount: 5,
    })
    expect(model.reviewChecklist[1]).toMatchObject({
      section: '2.3',
      sectionLabel: '2.3 整体分布',
      hitCount: 3,
    })
  })
})
