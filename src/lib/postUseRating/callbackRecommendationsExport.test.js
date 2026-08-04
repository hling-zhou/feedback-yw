import { describe, expect, it } from 'vitest'
import { buildPostUseCallbackRecommendationRows } from './callbackRecommendationsExport.js'

describe('callbackRecommendationsExport', () => {
  it('expands quote and reason columns without concatenation', () => {
    const rows = buildPostUseCallbackRecommendationRows([
      {
        importMonths: ['2026-06'],
        customerName: '中国铁塔',
        customerCode: 'C1',
        productName: '弹性公网IP',
        triggerType: '7分以下重点客户',
        lowScoreLt7Count: 2,
        scoreBreakdown: '6分1次；5分1次',
        quoteCount: 2,
        reasonCount: 1,
        latestFeedbackAt: '2026-06-05T10:00:00.000Z',
        channels: ['console', 'sms'],
        recommendedReason: '建议回访',
        quotes: ['控制台原话2', '短信原话1'],
        reasons: ['功能有缺失'],
      },
    ])

    expect(rows[0]).toMatchObject({
      数据月份: '2026-06',
      客户名称: '中国铁塔',
      产品名称: '弹性公网IP',
      '7分以下总次数': 2,
      客户原话1: '控制台原话2',
      客户原话2: '短信原话1',
      低分原因1: '功能有缺失',
    })
  })
})
