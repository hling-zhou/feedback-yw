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
        '不使用了', '不用了', '否', '暂无', '不再使用', '使用到期',
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

  it('treats bare 好/非常好 as positive words, not negative feedback (2026-11-04 真实库高频变体)', () => {
    // sentiment 词典对单字正面词判 neutral_inquiry ≠ positive → 曾被误判为负面
    expect(isSubstantiveFeedbackReason('好')).toBe(false)
    expect(isSubstantiveFeedbackReason('非常好')).toBe(false)
    // 它们仍是有效客户文本（不出局占位词集合）
    expect(isValidCustomerText('好')).toBe(true)
    expect(isValidCustomerText('非常好')).toBe(true)
  })

  it('分号拼接串按整串判定时不逃逸占位组合（2026-11-04 修复：消费方应拆片判定）', () => {
    // 整串不在占位词集合 → 精确匹配逃逸 → 曾经被判负面。此断言锁定「整串判定为负面」这一事实，
    // recordHasNegativeFeedback / pickHighFrequencyLowScoreReason 等消费方必须拆片后逐片判定。
    expect(isSubstantiveFeedbackReason('其他;业务使用完毕无后续使用需求')).toBe(true)
    expect(isSubstantiveFeedbackReason('业务使用完毕无后续使用需求;其他')).toBe(true)
    // 拆片后每片都是占位词，不应有任一片判负
    expect(splitFeedbackReasonPieces('其他;业务使用完毕无后续使用需求')
      .map(isSubstantiveFeedbackReason)).toEqual([false, false])
    // 混有真负面片的串：拆片后仍判负（修复不误伤）
    expect(splitFeedbackReasonPieces('无/不涉及;功能有缺失')
      .some(isSubstantiveFeedbackReason)).toBe(true)
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

  it('treats a bare 退订 as a business action, not substantive negative (2026-10-19 rule)', () => {
    // 整条恰为「退订」二字：业务动作诉求，不算负面反馈
    expect(isSubstantiveFeedbackReason('退订')).toBe(false)
    // 仍是有效客户文本：保留在客户原话登记等消费方
    expect(isValidCustomerText('退订')).toBe(true)
    expect(classifyCustomerTextKind('退订')).toBe('quote')
    // 带上下文的退订类表述仍按实质反馈处理（不误伤）
    expect(isSubstantiveFeedbackReason('退订失败')).toBe(true)
    expect(isSubstantiveFeedbackReason('无法退订')).toBe(true)
    expect(isSubstantiveFeedbackReason('想退订共享带宽')).toBe(true)
    expect(isSubstantiveFeedbackReason('退订后配额未释放')).toBe(true)
    // 分号拆分后逐条判定：裸「退订」片不算负面，同格里的其他负面片仍算
    const pieces = splitFeedbackReasonPieces('退订;稳定性不足故障频发')
    expect(pieces).toEqual(['退订', '稳定性不足故障频发'])
    expect(pieces.map(isSubstantiveFeedbackReason)).toEqual([false, true])
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
