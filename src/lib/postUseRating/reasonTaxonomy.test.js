import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_REASON_PLACEHOLDERS,
  classifyCustomerTextKind,
  isSubstantiveFeedbackReason,
  isValidCustomerText,
  splitFeedbackReasonPieces,
} from './reasonTaxonomy.js'

describe('substantive feedback reason', () => {
  it('rejects the shared placeholder set, nan, numeric scores, and latin-only tokens', () => {
    expect([...FEEDBACK_REASON_PLACEHOLDERS]).toEqual(
      expect.arrayContaining([
        '无', '无/不涉及', '/', '业务使用完毕', '业务使用完毕无后续使用需求', '其他',
      ]),
    )
    for (const text of FEEDBACK_REASON_PLACEHOLDERS) {
      expect(isSubstantiveFeedbackReason(text)).toBe(false)
      expect(isValidCustomerText(text)).toBe(false)
    }
    expect(isSubstantiveFeedbackReason('nan')).toBe(false)
    expect(isSubstantiveFeedbackReason('10')).toBe(false)
    expect(isSubstantiveFeedbackReason('abc')).toBe(false)
    expect(isSubstantiveFeedbackReason('')).toBe(false)
  })

  it('excludes obvious positive words from substantive feedback but still treats them as valid customer text', () => {
    for (const text of [
      '满意', '非常满意', '很满意', '挺满意', '比较满意',
      '感谢', '好评', '很好', '挺好', '不错', '赞', '可以', '还行',
      '好用', '很好用',
    ]) {
      expect(isSubstantiveFeedbackReason(text)).toBe(false)
      expect(isValidCustomerText(text)).toBe(true)
    }
  })

  it('uses sentiment as a fallback to exclude longer positive free text', () => {
    // 长句正面：精确集合命中不到，靠 sentiment 兜底剔除
    expect(isSubstantiveFeedbackReason('非常满意，服务很好')).toBe(false)
    expect(isSubstantiveFeedbackReason('感谢你们的支持')).toBe(false)
  })

  it('keeps negated-positive wording as substantive negative (sentiment blind spot)', () => {
    // sentiment 会把「不太满意」误判为 positive，这里靠否定式守卫按负面保留
    expect(isSubstantiveFeedbackReason('不太满意')).toBe(true)
    expect(isSubstantiveFeedbackReason('不满意')).toBe(true)
    expect(isSubstantiveFeedbackReason('不很好用')).toBe(true)
    // 「不错」是正面词，不应被否定守卫误留
    expect(isSubstantiveFeedbackReason('不错')).toBe(false)
  })

  it('accepts taxonomy labels and free-text complaints', () => {
    expect(isSubstantiveFeedbackReason('功能有缺失')).toBe(true)
    expect(isSubstantiveFeedbackReason('完全是垃圾，网都上不了')).toBe(true)
    // 含「满意」但整条非纯正面词，sentiment 不会判为 positive，仍算实质负面
    expect(isSubstantiveFeedbackReason('不太满意')).toBe(true)
    // 含「好用」但整条为负面，不会被误剔
    expect(isSubstantiveFeedbackReason('不好用')).toBe(true)
  })

  it('splits multi-select cells then classifies option vs quote', () => {
    expect(splitFeedbackReasonPieces('功能有缺失;缺乏操作指引')).toEqual(['功能有缺失', '缺乏操作指引'])
    expect(classifyCustomerTextKind('功能有缺失')).toBe('option')
    expect(classifyCustomerTextKind('未解决')).toBe('option')
    expect(classifyCustomerTextKind('界面不好用')).toBe('quote')
    expect(classifyCustomerTextKind('其他')).toBeNull()
  })
})
