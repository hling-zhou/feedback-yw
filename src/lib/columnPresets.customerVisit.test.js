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
      remark: '备注',
    })
  })

  it('still detects the template when the optional remark column is absent', () => {
    const withoutRemark = detectPreset(
      ['数据月份', '客户名称', '客户编码', '产品名称', '回访结果', '内部评估'],
      'post_use_rating',
      { postUseRatingSubType: 'customer_visit' },
    )
    const withRemark = detectPreset(
      ['数据月份', '客户名称', '客户编码', '产品名称', '回访结果', '内部评估', '备注'],
      'post_use_rating',
      { postUseRatingSubType: 'customer_visit' },
    )

    expect(withoutRemark?.id).toBe(POST_USE_CUSTOMER_VISIT_PRESET.id)
    expect(withRemark?.columnMap.remark).toBe('备注')
  })

  it('detects the template when both internal evaluation and remark columns are absent', () => {
    const preset = detectPreset(
      ['数据月份', '客户名称', '客户编码', '产品名称', '回访结果'],
      'post_use_rating',
      { postUseRatingSubType: 'customer_visit' },
    )

    expect(preset?.id).toBe(POST_USE_CUSTOMER_VISIT_PRESET.id)
    expect(preset?.columnMap.internalConclusion).toBe('内部评估')
  })
})
