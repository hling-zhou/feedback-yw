import { describe, expect, it } from 'vitest'
import { buildHighFrequencyLowScoreReasonRows, buildIssueChanges, buildNeedInsights, buildPostUseInsightBundle, buildProductExperienceOverview, buildSceneJourneyAnalysis, buildUnclassifiedNeedEvidence } from './insights.js'

const row = (id, overrides = {}) => ({ id, dataSourceType: 'post_use_rating', productName: '弹性公网IP', ratingScore: 8, importMonth: '2026-06', ...overrides })

describe('post-use insight models', () => {
  it('PUR-08 uses original evaluation scene and existing journey only', () => {
    const result = buildSceneJourneyAnalysis([
      row('a', { scene: '资源创建后', journeyL1: '开通', requestScene: '不应使用', problemType: '不应使用' }),
      row('b', { scene: '', journeyL1: '' }),
    ])
    expect(result).toEqual(expect.arrayContaining([
      expect.objectContaining({ originalScene: '资源创建后', journey: '开通' }),
      expect.objectContaining({ originalScene: '未提供', journey: '未识别环节' }),
    ]))
    expect(JSON.stringify(result)).not.toContain('不应使用')
  })

  it('recognizes multiple reasons and keeps evidence ids', () => {
    const [needA, needB] = buildNeedInsights([
      row('e1', { rawText: '功能有缺失，同时缺乏操作指引', customerCode: 'C1' }),
    ])
    expect([needA.need, needB.need]).toEqual(expect.arrayContaining(['功能有缺失', '缺乏操作指引']))
    expect(needA.evidenceIds).toContain('e1')
  })

  it('keeps unclassified text in quality evidence only', () => {
    const records = [row('unknown', { rawText: '希望可以一键完成整个配置流程', customerCode: 'C1' })]
    expect(buildNeedInsights(records)).toEqual([])
    expect(buildIssueChanges(records)).toEqual([])
    expect(buildUnclassifiedNeedEvidence(records)).toEqual([
      expect.objectContaining({ id: 'unknown', productName: '弹性公网IP', score: 8 }),
    ])
    const bundle = buildPostUseInsightBundle(records)
    expect(bundle.needs).toEqual([])
    expect(bundle.issueChanges).toEqual([])
    expect(bundle.unclassifiedNeeds).toHaveLength(1)
  })

  it('explains product state and issue lifecycle', () => {
    const products = buildProductExperienceOverview(Array.from({ length: 10 }, (_, i) => row(`r${i}`, { ratingScore: 8 })))
    expect(products[0]).toMatchObject({ state: '重点改善', ruleVersion: 'pur-insight-v1' })
    const changes = buildIssueChanges([
      row('old', { importMonth: '2026-05', rawText: '功能有缺失' }),
      row('new1', { rawText: '功能有缺失' }),
      row('new2', { rawText: '功能有缺失' }),
    ])
    expect(changes[0]).toMatchObject({ issue: '功能有缺失', change: '增长', previousCount: 1, currentCount: 2 })
  })

  it('does not mix option-channel scores into product experience averages', () => {
    const products = buildProductExperienceOverview([
      row('console', { ratingScore: 10, channel: 'console' }),
      row('option', { ratingScore: 1, channel: 'option' }),
    ])
    expect(products[0]).toMatchObject({
      sampleSize: 1,
      avgScore: 10,
      nonTenCount: 0,
    })
  })

  it('marks small-sample products with score <= 3 as critical', () => {
    const products = buildProductExperienceOverview([
      row('r1', { ratingScore: 3 }),
      row('r2', { ratingScore: 10 }),
      row('r3', { ratingScore: 10 }),
    ])
    expect(products[0]).toMatchObject({
      sampleSize: 3,
      minScore: 3,
      hasCriticalLowScore: true,
      state: '重点改善',
      stateCode: 'critical',
    })
    expect(products[0].explanation).toContain('3 分及以下极低分')
  })

  it('uses customer visits as evidence without changing score metrics', () => {
    const records = [row('r1', { ratingScore: 8, rawText: '功能有缺失', customerName: '客户A', customerCode: 'C1' })]
    const visits = [{ id: 'v1', importMonth: '2026-06', productName: '弹性公网IP', userInfo: '客户A C1', feedbackSummary: '功能有缺失', internalConclusion: '需求接纳' }]
    const bundle = buildPostUseInsightBundle(records, { visits })
    expect(bundle.products[0]).toMatchObject({ sampleSize: 1, avgScore: 8, visitEvidenceCount: 1 })
    expect(bundle.needs.find((item) => item.need === '功能有缺失')).toMatchObject({ count: 1, visitEvidenceCount: 1 })
    expect(bundle.customers[0]).toMatchObject({ nonTenCount: 1, visitEvidenceCount: 1, visitConclusion: '需求接纳' })
  })

  it('builds high-frequency low-score reason rows from console records per LD 3.8', () => {
    const reasons = buildHighFrequencyLowScoreReasonRows([
      row('c1', { channel: 'console', ratingScore: 6, customerName: '中国铁塔华北', customerCode: 'K1', lowScoreReason: '不应命中', commentText: '无', rawText: '不应命中', feedbackReasonTexts: ['功能有缺失'] }),
      row('c2', { channel: 'console', ratingScore: 5, customerName: '客户B', customerCode: 'C2', lowScoreReason: '不应命中', rawText: '不应命中', feedbackReasonTexts: ['功能有缺失'] }),
      row('c3', { channel: 'console', ratingScore: 4, customerName: '客户C', customerCode: 'C3', lowScoreReason: '不应命中', rawText: '不应命中', feedbackReasonTexts: ['缺乏操作指引'] }),
      row('c4', { channel: 'console', ratingScore: 6, customerName: '客户D', customerCode: 'C4', lowScoreReason: '不应命中', commentText: '不应命中', rawText: '不应命中', feedbackReasonTexts: ['其他', '内容/帮助说明不易懂'] }),
      row('c5', { channel: 'sms', ratingScore: 5, customerName: '客户E', customerCode: 'C5', lowScoreReason: '功能有缺失', rawText: '功能有缺失', feedbackReasonTexts: ['功能有缺失'] }),
      row('c6', { channel: 'console', ratingScore: 8, customerName: '客户F', customerCode: 'C6', lowScoreReason: '功能有缺失', rawText: '功能有缺失', feedbackReasonTexts: ['功能有缺失'] }),
    ], {
      keyCustomers: ['中国铁塔'],
      productNames: ['弹性公网IP'],
    })

    expect(reasons).toEqual(expect.arrayContaining([
      expect.objectContaining({
        lowScoreFeedback: '功能有缺失',
        feedbackCount: 2,
        customerName: '中国铁塔华北',
        customerTag: '重点',
      }),
      expect.objectContaining({
        lowScoreFeedback: '内容/帮助说明不易懂',
        feedbackCount: 1,
        customerName: '客户D',
      }),
    ]))
    expect(reasons.some((item) => item.customerName === '客户E')).toBe(false)
    expect(reasons.some((item) => item.customerName === '客户F')).toBe(false)
  })

  it('uses only customer-answer fields for high-frequency low-score reasons', () => {
    const reasons = buildHighFrequencyLowScoreReasonRows([
      row('c1', {
        channel: 'console',
        ratingScore: 6,
        customerName: '中国铁塔华东',
        customerCode: 'K2',
        lowScoreReason: '这里不该被拿来做高频低分原因',
        commentText: '这里也不该被拿来做高频低分原因',
        rawText: '这里也不该被拿来做高频低分原因',
        feedbackReasonTexts: ['无', '客户回答A', '客户回答B'],
      }),
    ], {
      keyCustomers: ['中国铁塔'],
      productNames: ['弹性公网IP'],
    })

    expect(reasons).toEqual([
      expect.objectContaining({
        customerName: '中国铁塔华东',
        lowScoreFeedback: '客户回答A',
      }),
    ])
  })
})
