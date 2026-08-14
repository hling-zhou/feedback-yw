import { describe, expect, it } from 'vitest'
import {
  buildCallbackNonTenFollowupFeedback,
  buildFollowupTableExportRows,
  buildQuestionnaireFollowupFeedback,
  collectFollowupExportRows,
  toCallbackNonTenFollowupRow,
  toJiraArchivePayload,
  toQuestionnaireFollowupRow,
} from './callbackFollowupTables.js'

describe('callbackFollowupTables', () => {
  it('joins questionnaire score breakdown and feedback reasons into 客户反馈', () => {
    const item = {
      importMonths: ['2026-06'],
      customerName: '中国铁塔',
      customerCode: 'C1',
      productName: '弹性公网IP',
      scoreBreakdown: '旧问卷*6分*1次',
      feedbackReasonSummary: '功能有缺失（1）',
    }
    expect(buildQuestionnaireFollowupFeedback(item)).toBe(
      '7分以下分布：旧问卷*6分*1次；反馈原因：功能有缺失（1）',
    )
    expect(toQuestionnaireFollowupRow(item)).toMatchObject({
      itemKey: 'q:C1:弹性公网IP',
      sourceType: 'questionnaire',
      数据月份: '2026-06',
      客户反馈: '7分以下分布：旧问卷*6分*1次；反馈原因：功能有缺失（1）',
    })
  })

  it('keeps only 反馈原因 in 客户反馈 when there is no 7分以下分布', () => {
    expect(
      buildQuestionnaireFollowupFeedback({
        feedbackReasonSummary: '功能有缺失（1）',
      }),
    ).toBe('反馈原因：功能有缺失（1）')
  })

  it('joins callback non-ten fields into 客户反馈', () => {
    const item = {
      importMonth: '2026-06',
      customerName: '客户A',
      customerCode: 'C1',
      productName: '弹性公网IP',
      originalTicketId: 'T-001',
      score: 8,
      dissatisfactionReason: '处理周期长',
      customerRequest: '无法绑定弹性公网IP',
      problemCause: '配置入口缺失',
    }
    expect(buildCallbackNonTenFollowupFeedback(item)).toBe(
      '原工单编号：T-001；投诉整体服务评价：8；不满原因：处理周期长；客户请求内容：无法绑定弹性公网IP；问题原因：配置入口缺失',
    )
    expect(toCallbackNonTenFollowupRow(item).itemKey).toBe('c:T-001')
  })

  it('collects checked rows for 待客服回访 / 待内部提单 and strips item keys on export', () => {
    const questionnaire = [
      {
        itemKey: 'q:C1:弹性公网IP',
        importMonths: ['2026-06'],
        customerName: '中国铁塔',
        customerCode: 'C1',
        productName: '弹性公网IP',
        scoreBreakdown: '旧问卷*6分*1次',
        feedbackReasonSummary: '功能有缺失（1）',
      },
    ]
    const callback = [
      {
        itemKey: 'c:T-001',
        importMonth: '2026-06',
        customerName: '客户A',
        customerCode: 'C1',
        productName: '弹性公网IP',
        originalTicketId: 'T-001',
        score: 8,
        dissatisfactionReason: '处理周期长',
      },
    ]
    const decisions = new Map([
      ['q:C1:弹性公网IP', { needCustomerVisit: true, needInternalTrace: true }],
      ['c:T-001', { needCustomerVisit: true, needInternalTrace: false }],
    ])

    const visitRows = collectFollowupExportRows(questionnaire, callback, decisions, 'needCustomerVisit')
    const traceRows = collectFollowupExportRows(questionnaire, callback, decisions, 'needInternalTrace')
    expect(visitRows).toHaveLength(2)
    expect(traceRows).toHaveLength(1)
    expect(traceRows[0].itemKey).toBe('q:C1:弹性公网IP')
    expect(buildFollowupTableExportRows(visitRows)[0]).toEqual({
      数据月份: '2026-06',
      客户名称: '中国铁塔',
      客户编码: 'C1',
      产品名称: '弹性公网IP',
      客户反馈: '7分以下分布：旧问卷*6分*1次；反馈原因：功能有缺失（1）',
    })
    expect(toJiraArchivePayload(traceRows[0])).toMatchObject({
      itemKey: 'q:C1:弹性公网IP',
      sourceType: 'questionnaire',
      customerName: '中国铁塔',
      productName: '弹性公网IP',
    })
  })
})
