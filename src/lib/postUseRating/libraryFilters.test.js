import { describe, expect, it } from 'vitest'
import { EMPTY_FILTER_TOKEN } from '../feedbackFilters.js'
import {
  getPostUseChannelKey,
  getPostUseChannelLabel,
  listPostUseChannelFilterOptions,
  listPostUseRatingFilterOptions,
  matchesCommentKeywordFilter,
  matchesPostUseChannelFilter,
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
})
