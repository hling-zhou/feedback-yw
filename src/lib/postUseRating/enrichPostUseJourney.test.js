import { describe, expect, it } from 'vitest'
import {
  enrichPostUseJourneyBatch,
  enrichPostUseJourneyRecord,
  matchPostUseJourneyFromText,
  needsPostUseJourney,
  POST_USE_JOURNEY_UNKNOWN_L1,
} from './enrichPostUseJourney.js'

describe('enrichPostUseJourney', () => {
  it('matches journey keywords from text', () => {
    expect(matchPostUseJourneyFromText('无法开通弹性公网IP')).toEqual({
      journeyL1: '开通',
      journeyL2: '开通/创建',
    })
    expect(matchPostUseJourneyFromText('想退订共享带宽')).toEqual({
      journeyL1: '退订',
      journeyL2: '退订/释放',
    })
    expect(matchPostUseJourneyFromText('完全无意义的话')).toEqual({
      journeyL1: POST_USE_JOURNEY_UNKNOWN_L1,
      journeyL2: '未识别子环节',
    })
  })

  it('needsPostUseJourney only for non-10 library records without journey', () => {
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 8,
      }),
    ).toBe(true)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 10,
      }),
    ).toBe(false)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'callback',
        ratingScore: 5,
      }),
    ).toBe(false)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'console',
        ratingScore: 7,
        journeyL1: '使用',
      }),
    ).toBe(false)
  })

  it('enrichPostUseJourneyRecord returns patch with source', () => {
    const patch = enrichPostUseJourneyRecord({
      dataSourceType: 'post_use_rating',
      channel: 'console',
      ratingScore: 6,
      commentText: '计费不清晰价格贵',
    })
    expect(patch).toEqual({
      journeyL1: '费用',
      journeyL2: '计费/价格',
      journeySource: 'post_use_non10',
    })

    const batch = enrichPostUseJourneyBatch([
      {
        id: 'a',
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 4,
        rawText: '账号权限申请失败',
      },
      {
        id: 'b',
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 10,
        rawText: '账号权限',
      },
    ])
    expect(batch).toHaveLength(1)
    expect(batch[0].id).toBe('a')
    expect(batch[0].patch.journeyL1).toBe('账号')
  })
})
