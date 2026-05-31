import { describe, expect, it } from 'vitest'
import {
  analyzeSentiment,
  analyzeTicketSentiment,
  analyzeUrgencyLevel,
  getUrgencyLevel,
  isNegativeSentiment,
  normalizeSentiment,
  normalizeUrgencyLevel,
} from './sentiment.js'

describe('analyzeTicketSentiment', () => {
  it('detects urgency separately from negative sentiment', () => {
    const r = analyzeTicketSentiment('请尽快处理，业务中断了，催了很多次')
    expect(r.sentiment).not.toBe('urgent')
    expect(r.urgencyLevel).toBe('high')
  })

  it('maps complaint context to mild_negative when no keywords hit', () => {
    expect(analyzeSentiment('EIP绑定失败，报错无法连接')).toBe('mild_negative')
  })

  it('does not treat 投诉 alone in complaint context as negative without keyword', () => {
    expect(analyzeSentiment('工单编号12345')).toBe('neutral_inquiry')
  })

  it('strong negative wins over urgency words', () => {
    const r = analyzeTicketSentiment('太差了，垃圾服务，催了很多次要赔偿')
    expect(r.sentiment).toBe('strong_negative')
    expect(r.urgencyLevel).toBe('high')
  })

  it('positive requires no strong negative and enough positive hits', () => {
    expect(analyzeSentiment('非常满意，感谢工程师，问题解决了')).toBe('positive')
    expect(analyzeSentiment('感谢，但还是很慢未解决')).not.toBe('positive')
  })
})

describe('legacy normalization', () => {
  it('maps urgent sentiment to negative with high urgency', () => {
    expect(normalizeSentiment('urgent')).toBe('negative')
    expect(normalizeUrgencyLevel(undefined, 'urgent')).toBe('high')
    expect(getUrgencyLevel({ sentiment: 'urgent' })).toBe('high')
  })

  it('legacy urgent normalizes to negative and counts as negative sentiment', () => {
    expect(isNegativeSentiment('urgent')).toBe(true)
    expect(isNegativeSentiment('neutral_inquiry')).toBe(false)
  })
})

describe('analyzeUrgencyLevel', () => {
  it('returns none for neutral text', () => {
    expect(analyzeUrgencyLevel('请问如何配置带宽')).toBe('none')
  })
})
