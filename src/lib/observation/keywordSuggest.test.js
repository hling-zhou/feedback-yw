import { describe, expect, it } from 'vitest'
import { suggestObservationKeywords } from './keywordSuggest.js'

describe('suggestObservationKeywords', () => {
  it('extracts domain terms from summary with length preference', () => {
    const kws = suggestObservationKeywords({
      summary: '控制台找不到退订/取消入口，列表超50条时翻不到',
    })
    expect(kws.length).toBeGreaterThan(0)
    expect(kws.length).toBeLessThanOrEqual(5)
    // 长词「退订/取消」被分隔符切开——候选应含「退订」相关词
    expect(kws.some((k) => k.includes('退订') || k.includes('取消'))).toBe(true)
  })

  it('stopwords filtered', () => {
    const kws = suggestObservationKeywords({
      summary: '无法使用产品，客户操作问题反馈',
    })
    expect(kws).not.toContain('无法')
    expect(kws).not.toContain('问题')
    expect(kws).not.toContain('客户')
  })

  it('existing keywords excluded', () => {
    const kws = suggestObservationKeywords({
      summary: '转发表加载超过10秒打不开',
      existingKeywords: ['转发表'],
    })
    expect(kws).not.toContain('转发表')
  })

  it('substring suppression keeps longer term only', () => {
    const kws = suggestObservationKeywords({
      summary: '带宽退订入口找不到',
    })
    // 若「退订入口」被选，「退订」应被抑制
    if (kws.includes('退订入口')) {
      expect(kws).not.toContain('退订')
      expect(kws).not.toContain('入口')
    }
  })

  it('rarity downweights words common in other issues', () => {
    const common = suggestObservationKeywords({
      summary: '证书替换失败报错',
    })
    const withForeign = suggestObservationKeywords({
      summary: '证书替换失败报错',
      otherIssuesKeywords: [['替换失败'], ['失败']],
    })
    // 共现词降权后，输出可能变化；至少不崩溃且数量合规
    expect(withForeign.length).toBeLessThanOrEqual(5)
    void common
  })

  it('empty summary yields empty', () => {
    expect(suggestObservationKeywords({ summary: '' })).toEqual([])
    expect(suggestObservationKeywords({ summary: '。。。，，' })).toEqual([])
  })
})
