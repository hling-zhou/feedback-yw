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
      expect.arrayContaining(['无', '无/不涉及', '/', '业务使用完毕', '其他']),
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

  it('accepts taxonomy labels and free-text complaints', () => {
    expect(isSubstantiveFeedbackReason('功能有缺失')).toBe(true)
    expect(isSubstantiveFeedbackReason('完全是垃圾，网都上不了')).toBe(true)
  })

  it('splits multi-select cells then classifies option vs quote', () => {
    expect(splitFeedbackReasonPieces('功能有缺失;缺乏操作指引')).toEqual(['功能有缺失', '缺乏操作指引'])
    expect(classifyCustomerTextKind('功能有缺失')).toBe('option')
    expect(classifyCustomerTextKind('未解决')).toBe('option')
    expect(classifyCustomerTextKind('界面不好用')).toBe('quote')
    expect(classifyCustomerTextKind('其他')).toBeNull()
  })
})
