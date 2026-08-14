import { describe, expect, it } from 'vitest'
import {
  buildCustomerQuoteRegistry,
  classifyFeedbackPolarity,
  collectCustomerQuoteSourceValues,
  extractValidCustomerTexts,
  pickFeaturedVoiceQuotes,
  pickIssueEvidenceTexts,
  summarizeQuotePolarity,
} from './customerQuotes.js'

describe('customer quote extraction', () => {
  it('uses feedback reasons for console/option and commentText for sms/callback', () => {
    expect(collectCustomerQuoteSourceValues({
      channel: 'console',
      feedbackReasonTexts: ['功能有缺失'],
      commentText: '页面太卡了',
      lowScoreReason: '不满原因不应出现',
    })).toEqual(['功能有缺失'])
    expect(collectCustomerQuoteSourceValues({
      channel: 'sms',
      commentText: '网都上不了',
      lowScoreReason: '不满原因不应出现',
    })).toEqual(['网都上不了'])
    expect(collectCustomerQuoteSourceValues({
      channel: 'callback',
      commentText: '处理太慢',
      lowScoreReason: '产品质量',
    })).toEqual(['处理太慢'])
  })

  it('does not treat dissatisfaction reason as a quote when comment is empty', () => {
    expect(extractValidCustomerTexts({
      channel: 'sms',
      commentText: '',
      lowScoreReason: '界面不好用',
      productName: '弹性公网IP',
    })).toEqual([])
  })

  it('classifies taxonomy labels as options and free text as quotes', () => {
    const items = extractValidCustomerTexts({
      channel: 'console',
      productName: '弹性公网IP',
      customerName: '客户甲',
      ratingScore: 6,
      feedbackReasonTexts: ['功能有缺失;缺乏操作指引', '界面不好用', '其他', '/'],
    })
    expect(items.map((item) => [item.kind, item.polarity, item.text])).toEqual([
      ['option', 'negative', '功能有缺失'],
      ['option', 'negative', '缺乏操作指引'],
      ['quote', 'negative', '界面不好用'],
    ])
  })

  it('marks 10-point free text as positive and taxonomy options as negative even at 10', () => {
    expect(classifyFeedbackPolarity({ kind: 'quote', score: 10, text: '用着很稳定' })).toBe('positive')
    expect(classifyFeedbackPolarity({ kind: 'quote', score: 8 })).toBe('negative')
    expect(classifyFeedbackPolarity({ kind: 'option', score: 10 })).toBe('negative')
    const praise = extractValidCustomerTexts({
      channel: 'sms',
      productName: '弹性公网IP',
      ratingScore: 10,
      commentText: '用着很稳定',
    })
    expect(praise[0]).toMatchObject({ kind: 'quote', polarity: 'positive', text: '用着很稳定' })
    const optionAtTen = extractValidCustomerTexts({
      channel: 'console',
      productName: '弹性公网IP',
      ratingScore: 10,
      feedbackReasonTexts: ['功能有缺失'],
    })
    expect(optionAtTen[0]).toMatchObject({ kind: 'option', polarity: 'negative', text: '功能有缺失' })
  })

  it('overrides 10-point free text to negative when the wording is negative', () => {
    expect(classifyFeedbackPolarity({ kind: 'quote', score: 10, text: '太卡了不好用' })).toBe('negative')
    expect(classifyFeedbackPolarity({ kind: 'quote', score: 10, text: '经常断网' })).toBe('negative')
    const mixed = extractValidCustomerTexts({
      channel: 'sms',
      productName: '弹性公网IP',
      ratingScore: 10,
      commentText: '给了满分但还是太卡了',
    })
    expect(mixed[0]).toMatchObject({ kind: 'quote', polarity: 'negative', text: '给了满分但还是太卡了' })
  })

  it('prefers quotes over options on an issue card', () => {
    const picked = pickIssueEvidenceTexts([
      { kind: 'option', text: '功能有缺失' },
      { kind: 'quote', text: '界面不好用', customerName: '甲', score: 6, channelLabel: '官网评分类' },
      { kind: 'quote', text: '经常打不开', customerName: '乙', score: 5, channelLabel: '短信渠道' },
    ])
    expect(picked.quotes.map((item) => item.text)).toEqual(['界面不好用', '经常打不开'])
    expect(picked.options).toEqual([])
  })

  it('falls back to at most two options when there is no quote', () => {
    const picked = pickIssueEvidenceTexts([
      { kind: 'option', text: '功能有缺失' },
      { kind: 'option', text: '缺乏操作指引' },
      { kind: 'option', text: '页面打开慢' },
    ])
    expect(picked.quotes).toEqual([])
    expect(picked.options.map((item) => item.text)).toEqual(['功能有缺失', '缺乏操作指引'])
  })

  it('keeps positive quotes off the problem evidence list', () => {
    const picked = pickIssueEvidenceTexts([
      { kind: 'quote', polarity: 'positive', text: '用着很稳定', score: 10 },
      { kind: 'quote', polarity: 'negative', text: '经常打不开', score: 5 },
      { kind: 'option', polarity: 'negative', text: '功能有缺失' },
    ])
    expect(picked.quotes.map((item) => item.text)).toEqual(['经常打不开'])
    expect(picked.positiveQuotes.map((item) => item.text)).toEqual(['用着很稳定'])
    expect(picked.options).toEqual([])
  })

  it('summarizes featured positive and negative voice separately', () => {
    const registry = buildCustomerQuoteRegistry([
      {
        channel: 'sms',
        productName: '弹性公网IP',
        customerName: '客户甲',
        ratingScore: 4,
        commentText: '网都上不了',
      },
      {
        channel: 'sms',
        productName: '弹性公网IP',
        customerName: '客户乙',
        ratingScore: 10,
        commentText: '用着很稳定',
      },
    ])
    expect(summarizeQuotePolarity(registry)).toMatchObject({
      positiveCount: 1,
      negativeCount: 1,
      positiveQuotes: 1,
      negativeQuotes: 1,
    })
    expect(pickFeaturedVoiceQuotes(registry).positive[0].text).toBe('用着很稳定')
    expect(pickFeaturedVoiceQuotes(registry).negative[0].text).toBe('网都上不了')
  })

  it('builds an appendix registry with channel, product, score and original text', () => {
    const registry = buildCustomerQuoteRegistry([
      {
        channel: 'sms',
        productName: '弹性公网IP',
        customerName: '客户甲',
        customerCode: 'C1',
        ratingScore: 4,
        createdAt: '2026-06-02',
        commentText: '网都上不了',
        lowScoreReason: '不满原因',
      },
    ])
    expect(registry).toEqual([
      expect.objectContaining({
        kind: 'quote',
        channelLabel: '短信渠道',
        productName: '弹性公网IP',
        customerName: '客户甲',
        customerCode: 'C1',
        score: 4,
        polarity: 'negative',
        text: '网都上不了',
      }),
    ])
  })
})
