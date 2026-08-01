import { describe, expect, it } from 'vitest'
import {
  detectPreset,
  POST_USE_CUSTOMER_VISIT_PRESET,
} from './columnPresets.js'

describe('customer visit preset detection', () => {
  it('detects the new minimal customer visit template headers', () => {
    const preset = detectPreset(
      ['月份', '产品名称', '用户反馈原文', '用户信息', '回访结果', '内部评估'],
      'post_use_rating',
      { postUseRatingSubType: 'customer_visit' },
    )

    expect(preset?.id).toBe(POST_USE_CUSTOMER_VISIT_PRESET.id)
    expect(preset?.columnMap).toMatchObject({
      visitMonth: '月份',
      productName: '产品名称',
      userFeedbackText: '用户反馈原文',
      userInfo: '用户信息',
      visitResult: '回访结果',
      internalConclusion: '内部评估',
    })
  })
})
