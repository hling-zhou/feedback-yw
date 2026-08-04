import { describe, expect, it } from 'vitest'
import {
  detectPreset,
  POST_USE_CUSTOMER_VISIT_PRESET,
} from './columnPresets.js'

describe('customer visit preset detection', () => {
  it('detects the new minimal customer visit template headers', () => {
    const preset = detectPreset(
      ['数据月份', '客户名称', '客户编码', '产品名称', '回访结果', '内部评估'],
      'post_use_rating',
      { postUseRatingSubType: 'customer_visit' },
    )

    expect(preset?.id).toBe(POST_USE_CUSTOMER_VISIT_PRESET.id)
    expect(preset?.columnMap).toMatchObject({
      visitMonth: '数据月份',
      productName: '产品名称',
      customerName: '客户名称',
      customerCode: '客户编码',
      visitResult: '回访结果',
      internalConclusion: '内部评估',
    })
  })
})
