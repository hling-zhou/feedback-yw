import { describe, expect, it } from 'vitest'
import { buildPostUseCustomerVisitRows } from './customerVisitExport.js'

describe('customerVisitExport', () => {
  it('merges imported customer visit rows with callback recommendation fields', () => {
    const rows = buildPostUseCustomerVisitRows(
      [
        {
          importMonth: '2026-05',
          customerName: '中国铁塔',
          customerCode: 'C001',
          productName: '云主机',
          visitResult: '已回访',
          internalConclusion: '建议跟进',
        },
      ],
      [
        {
          customerName: '中国铁塔',
          customerCode: 'C001',
          productName: '云主机',
          triggerType: '7分以下重点客户',
          lowScoreLt7Count: 2,
          scoreBreakdown: '6分1次；5分1次',
          quoteCount: 2,
          reasonCount: 1,
          latestFeedbackAt: '2026-05-21 10:00:00',
          channels: ['短信', '控制台'],
          recommendedReason: '建议客服部回访',
          quotes: ['原话A', '原话B'],
          reasons: ['原因A'],
        },
      ],
    )

    expect(rows).toEqual([
      expect.objectContaining({
        数据月份: '2026-05',
        客户名称: '中国铁塔',
        客户编码: 'C001',
        产品名称: '云主机',
        建议触发类型: '7分以下重点客户',
        '7分以下总次数': 2,
        回访结果: '已回访',
        内部评估: '建议跟进',
        客户原话1: '原话A',
        客户原话2: '原话B',
        低分原因1: '原因A',
      }),
    ])
  })
})
