import { describe, expect, it } from 'vitest'
import {
  analyzeSentiment,
  analyzeTicketSentiment,
  analyzeUrgencyLevel,
  getSentimentDisplayLabel,
  getUrgencyLevel,
  isNegativeSentiment,
  normalizeSentiment,
  normalizeUrgencyLevel,
  SENTIMENT_LABELS,
} from './sentiment.js'

describe('analyzeTicketSentiment', () => {
  it('detects urgency separately from negative sentiment', () => {
    const r = analyzeTicketSentiment('请尽快处理，业务中断了，催了很多次')
    expect(r.sentiment).not.toBe('urgent')
    expect(r.urgencyLevel).toBe('high')
  })

  it('keeps a bare failure report as inquiry', () => {
    expect(analyzeSentiment('EIP绑定失败，报错无法连接')).toBe('neutral_inquiry')
    expect(analyzeSentiment('申请退订这台云主机')).toBe('neutral_inquiry')
  })

  it('does not treat 投诉 alone in complaint context as negative without keyword', () => {
    expect(analyzeSentiment('工单编号12345')).toBe('neutral_inquiry')
  })

  it('strong negative wins over urgency words', () => {
    const r = analyzeTicketSentiment('太差了，垃圾服务，催了很多次要赔偿')
    expect(r.sentiment).toBe('strong_negative')
    expect(r.urgencyLevel).toBe('high')
  })

  it('treats one 满意 or 感谢 as positive, and ignores the closing boilerplate', () => {
    expect(analyzeSentiment('非常满意，感谢工程师，问题解决了')).toBe('positive')
    expect(analyzeSentiment('感谢，但还是很慢未解决')).toBe('positive')
    expect(analyzeSentiment('感谢您的理解与支持')).toBe('neutral_inquiry')
  })

  it('labels a complaint without attitude words as neutral', () => {
    const r = analyzeTicketSentiment('云主机开通20M共享带宽，现在实测仅40k', {
      dataSourceType: 'complaint_ticket',
    })
    expect(r.sentiment).toBe('neutral_general')
    expect(SENTIMENT_LABELS[r.sentiment]).toBe('中性')
    expect(getSentimentDisplayLabel(r)).toBe('中性')
    expect(r.urgencyLevel).toBe('none')
  })

  it('keeps urgency when a complaint has no attitude words', () => {
    const r = analyzeTicketSentiment('已经影响我业务了，麻烦尽快给我提升', {
      dataSourceType: 'complaint_ticket',
    })
    expect(r.sentiment).toBe('neutral_general')
    expect(r.urgencyLevel).toBe('high')
    expect(getSentimentDisplayLabel(r)).toBe('中性 · 加急')
  })

  it('does not treat 不满足 or 网卡 as attitude on a complaint', () => {
    expect(
      analyzeTicketSentiment('原有带宽不满足当前业务，申请扩容', {
        dataSourceType: 'complaint_ticket',
      }).sentiment,
    ).toBe('neutral_general')
    expect(
      analyzeTicketSentiment('弹性网卡配额只有6个，怎么调整', {
        dataSourceType: 'complaint_ticket',
      }).sentiment,
    ).toBe('neutral_general')
  })

  it('keeps an explicit attitude label on a complaint', () => {
    expect(
      analyzeTicketSentiment('入门机器性能太差，需要更换', {
        dataSourceType: 'complaint_ticket',
      }).sentiment,
    ).toBe('strong_negative')
  })

  it('does not promote symptom words, substrings, or resource ids', () => {
    expect(analyzeSentiment('这个IP丢包严重')).toBe('neutral_inquiry')
    expect(analyzeSentiment('连接中断，接口超时，报错误码')).toBe('neutral_inquiry')
    expect(analyzeSentiment('弹性网卡配额只有6个')).toBe('neutral_inquiry')
    expect(analyzeSentiment('测试结果与预期存在偏差')).toBe('neutral_inquiry')
    expect(analyzeSentiment('原有带宽不满足当前业务')).toBe('neutral_inquiry')
    expect(analyzeSentiment('负载均衡 badd228114ae 端口暴露')).toBe('neutral_inquiry')
    expect(analyzeSentiment('页面很差，给了差评')).toBe('negative')
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
    expect(isNegativeSentiment('neutral_general')).toBe(false)
  })
})

describe('analyzeUrgencyLevel', () => {
  it('returns none for neutral text', () => {
    expect(analyzeUrgencyLevel('请问如何配置带宽')).toBe('none')
  })
})
