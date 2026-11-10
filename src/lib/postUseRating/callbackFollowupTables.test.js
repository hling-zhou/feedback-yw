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
      itemKey: 'q:C1:弹性公网IP:2026-06',
      sourceType: 'questionnaire',
      数据月份: '2026-06',
      客户反馈: '7分以下分布：旧问卷*6分*1次；反馈原因：功能有缺失（1）',
    })
  })

  it('2026-11-06 方案B：问卷类 itemKey 带月份段——跨月勾选/归档按月独立，多月份并集排序 join', () => {
    // 单月
    expect(toQuestionnaireFollowupRow({
      importMonths: ['2026-08'],
      customerName: '客户X',
      customerCode: 'C9',
      productName: '共享带宽',
    }).itemKey).toBe('q:C9:共享带宽:2026-08')
    // 多月并集（不拆行拍板）：排序后 | join
    expect(toQuestionnaireFollowupRow({
      importMonths: ['2026-08', '2026-07'],
      customerName: '客户X',
      customerCode: 'C9',
      productName: '共享带宽',
    }).itemKey).toBe('q:C9:共享带宽:2026-07|2026-08')
    // 同客户同产品不同月 → 键不同（8 月勾选不影响 9 月行）
    const aug = toQuestionnaireFollowupRow({ importMonths: ['2026-08'], customerName: '客户X', customerCode: 'C9', productName: '共享带宽' })
    const sep = toQuestionnaireFollowupRow({ importMonths: ['2026-09'], customerName: '客户X', customerCode: 'C9', productName: '共享带宽' })
    expect(aug.itemKey).not.toBe(sep.itemKey)
    // decisions 按 8 月键勾选 → 9 月键的条目不受影响（跨月串扰修复的核心断言）
    const decisions = new Map([[aug.itemKey, { needCustomerVisit: true, needInternalTrace: true }]])
    const rows = collectFollowupExportRows([sep], [], decisions, 'needInternalTrace')
    expect(rows).toHaveLength(0)
    // 无客户编码时用客户名兜底段
    expect(toQuestionnaireFollowupRow({ importMonths: ['2026-08'], customerName: '匿名客户', productName: '云主机' }).itemKey).toBe('q:匿名客户:云主机:2026-08')
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

  it('collects checked rows for 待省代表回访 / 待内部提单 and strips item keys on export', () => {
    const questionnaire = [
      {
        itemKey: 'q:C1:弹性公网IP:2026-06',
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
      ['q:C1:弹性公网IP:2026-06', { needCustomerVisit: true, needInternalTrace: true }],
      ['c:T-001', { needCustomerVisit: true, needInternalTrace: false }],
    ])

    const visitRows = collectFollowupExportRows(questionnaire, callback, decisions, 'needCustomerVisit')
    const traceRows = collectFollowupExportRows(questionnaire, callback, decisions, 'needInternalTrace')
    expect(visitRows).toHaveLength(2)
    expect(traceRows).toHaveLength(1)
    expect(traceRows[0].itemKey).toBe('q:C1:弹性公网IP:2026-06')
    expect(buildFollowupTableExportRows(visitRows)[0]).toEqual({
      数据月份: '2026-06',
      客户名称: '中国铁塔',
      客户编码: 'C1',
      登录账号名称: '',
      产品名称: '弹性公网IP',
      相应投诉工单: '',
      客户反馈: '7分以下分布：旧问卷*6分*1次；反馈原因：功能有缺失（1）',
    })
    expect(toJiraArchivePayload(traceRows[0])).toMatchObject({
      itemKey: 'q:C1:弹性公网IP:2026-06',
      sourceType: 'questionnaire',
      customerName: '中国铁塔',
      productName: '弹性公网IP',
    })
  })
})
