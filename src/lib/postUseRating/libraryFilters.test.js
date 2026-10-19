import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER_TOKEN } from '../feedbackFilters.js'
import {
  getPostUseChannelKey,
  getPostUseChannelLabel,
  listPostUseChannelFilterOptions,
  listPostUseRatingFilterOptions,
  matchesCommentKeywordFilter,
  matchesPostUseChannelFilter,
  matchesPostUseQuickScopeFilter,
  matchesPostUseRatingFilter,
} from './libraryFilters.js'

describe('post-use library filters', () => {
  it('maps channel and sourceSubType to the same filter key', () => {
    expect(getPostUseChannelKey({ channel: 'sms' })).toBe('sms')
    expect(getPostUseChannelKey({ sourceSubType: 'web_survey' })).toBe('console')
    expect(getPostUseChannelLabel({ channel: 'option' })).toBe('选项类')
  })

  it('lists rating bands plus exact scores from records', () => {
    const options = listPostUseRatingFilterOptions([
      { ratingScore: 10 },
      { ratingScore: 8 },
      { ratingScore: 6 },
      { ratingScore: null },
    ])
    expect(options.map((item) => item.value)).toEqual([
      '10',
      'non10',
      'lt7',
      EMPTY_FILTER_TOKEN,
      '8',
      '6',
    ])
  })

  it('lists only channels that appear in records', () => {
    expect(
      listPostUseChannelFilterOptions([
        { channel: 'sms' },
        { sourceSubType: 'web_survey' },
        { channel: 'sms' },
      ]).map((item) => item.value),
    ).toEqual(['console', 'sms'])
  })

  it('matches rating bands and exact scores', () => {
    expect(matchesPostUseRatingFilter({ ratingScore: 10 }, '10')).toBe(true)
    expect(matchesPostUseRatingFilter({ ratingScore: 8 }, 'non10')).toBe(true)
    expect(matchesPostUseRatingFilter({ ratingScore: 10 }, 'non10')).toBe(false)
    expect(matchesPostUseRatingFilter({ ratingScore: 6 }, 'lt7')).toBe(true)
    expect(matchesPostUseRatingFilter({ ratingScore: 8 }, '8')).toBe(true)
    expect(matchesPostUseRatingFilter({}, EMPTY_FILTER_TOKEN)).toBe(true)
  })

  it('matches comment keyword against raw/comment/low-score text', () => {
    const record = { rawText: '网很卡', commentText: '', lowScoreReason: '延迟高' }
    expect(matchesCommentKeywordFilter(record, '延迟')).toBe(true)
    expect(matchesCommentKeywordFilter(record, '网很卡')).toBe(true)
    expect(matchesCommentKeywordFilter(record, '处理意见')).toBe(false)
    expect(matchesCommentKeywordFilter({ handlingText: '处理意见' }, '处理意见')).toBe(false)
  })

  it('matches channel filter by normalized key', () => {
    expect(matchesPostUseChannelFilter({ sourceSubType: 'sms_survey' }, 'sms')).toBe(true)
    expect(matchesPostUseChannelFilter({ channel: 'console' }, 'sms')).toBe(false)
  })

  it('quick scope highlights non-10 scores and 10-point negative feedback only', () => {
    // 非 10 分 → 重点关注
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 9 })).toBe(true)
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 6 })).toBe(true)
    // 10 分且反馈原因含负面表述 → 重点关注（复用建议回访清单同口径负面词典）
    // feedbackReasonTexts / feedbackReasonPrimary / commentText 三条链任一命中即可
    expect(
      matchesPostUseQuickScopeFilter({ ratingScore: 10, feedbackReasonTexts: ['稳定性不足故障频发'] }),
    ).toBe(true)
    expect(
      matchesPostUseQuickScopeFilter({ ratingScore: 10, feedbackReasonPrimary: '不太满意' }),
    ).toBe(true)
    expect(
      matchesPostUseQuickScopeFilter({ ratingScore: 10, commentText: '功能有缺失，希望补上' }),
    ).toBe(true)
    // 口语负面（太卡了/卡顿）也命中——负面口径覆盖现象级负面表述
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 10, commentText: '太卡了' })).toBe(true)
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 10, commentText: '页面有点卡' })).toBe(true)
    // 裸「退订」二字不算负面反馈（2026-10-19 用户规则）→ 10 分裸退订不进重点关注
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 10, commentText: '退订' })).toBe(false)
    expect(
      matchesPostUseQuickScopeFilter({ ratingScore: 10, feedbackReasonTexts: ['退订'] }),
    ).toBe(false)
    // 带上下文的退订表述仍是负面 → 仍进重点关注
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 10, commentText: '退订失败' })).toBe(true)
    // 10 分且无负面表述 → 不算重点关注
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 10, commentText: '很满意' })).toBe(false)
    expect(
      matchesPostUseQuickScopeFilter({ ratingScore: 10, feedbackReasonTexts: ['满意'] }),
    ).toBe(false)
    expect(matchesPostUseQuickScopeFilter({ ratingScore: 10 })).toBe(false)
    // 未评分记录 → 不算重点关注（用户拍板：严格按需求字面）
    expect(matchesPostUseQuickScopeFilter({ ratingScore: null })).toBe(false)
    expect(matchesPostUseQuickScopeFilter({})).toBe(false)
  })
})
