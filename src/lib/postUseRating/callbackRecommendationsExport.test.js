import { describe, expect, it } from 'vitest'
import {
  buildPostUseCallbackNonTenRows,
  buildPostUseCallbackRecommendationRows,
  buildPostUseCallbackWorkbook,
} from './callbackRecommendationsExport.js'

describe('callbackRecommendationsExport', () => {
  it('aggregates quote reason fields into single counted columns and puts recommended reason at the end', () => {
    const rows = buildPostUseCallbackRecommendationRows([
      {
        importMonths: ['2026-06'],
        customerName: '中国铁塔',
        customerCode: 'C1',
        productName: '弹性公网IP',
        triggerType: '重点客户；高频低分客户',
        lowScoreLt7Count: 2,
        scoreBreakdown: '6分1次；5分1次',
        latestFeedbackAt: '2026-06-05T10:00:00.000Z',
        latestSurveyName: '控制台用后即评',
        latestTouchpointPageName: '弹性公网IP详情页',
        channels: ['官网评分类', '选项类', '短信渠道'],
        recommendedReason: '建议回访',
        feedbackReasonSummary: '满意原因A（2）；意见建议B（1）',
      },
    ])

    expect(rows[0]).toMatchObject({
      数据月份: '2026-06',
      客户名称: '中国铁塔',
      产品名称: '弹性公网IP',
      '7分以下总次数': 2,
      '7分以下分布': '6分1次；5分1次',
      涉及渠道: '官网评分类；选项类；短信渠道',
      反馈原因: '满意原因A（2）；意见建议B（1）',
      建议回访原因: '建议回访',
    })
    expect(rows[0]).not.toHaveProperty('最近问卷名')
    expect(rows[0]).not.toHaveProperty('最近触点页面名称')
    expect(rows[0]).not.toHaveProperty('客户原话')
    expect(rows[0]).not.toHaveProperty('低分原因')
    expect(rows[0]).not.toHaveProperty('原话命中条数')
    expect(rows[0]).not.toHaveProperty('低分原因命中条数')
    expect(Object.keys(rows[0])).toEqual([
      '数据月份',
      '客户名称',
      '客户编码',
      '产品名称',
      '建议触发类型',
      '7分以下总次数',
      '7分以下分布',
      '最近反馈时间',
      '涉及渠道',
      '反馈原因',
      '建议回访原因',
    ])
    expect(Object.keys(rows[0]).at(-1)).toBe('建议回访原因')
  })

  it('maps callback non-ten rows to LD 3.9 columns', () => {
    const rows = buildPostUseCallbackNonTenRows([
      {
        productName: '弹性公网IP',
        originalTicketId: 'T-001',
        score: 8,
        customerName: '客户A',
        customerCode: 'C1',
        dissatisfactionReason: '处理周期长',
        customerRequest: '无法绑定弹性公网IP',
        problemCause: '配置入口缺失',
      },
    ])

    expect(rows).toEqual([
      {
        具体投诉产品: '弹性公网IP',
        原工单编号: 'T-001',
        投诉整体服务评价: 8,
        客户名称: '客户A',
        集团客户编码: 'C1',
        不满原因: '处理周期长',
        客户请求内容: '无法绑定弹性公网IP',
        问题原因: '配置入口缺失',
      },
    ])
  })

  it('builds workbook with two sheets', () => {
    const wb = buildPostUseCallbackWorkbook(
      [{ customerName: '中国铁塔', productName: '弹性公网IP', recommendedReason: '建议回访' }],
      [{ productName: '弹性公网IP', score: 8, customerName: '客户A' }],
    )

    expect(wb.SheetNames).toEqual(['官网问卷类建议回访', '投诉回访非10分'])
  })
})
