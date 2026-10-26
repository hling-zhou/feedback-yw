import { describe, expect, it } from 'vitest'
import {
  enrichPostUseJourneyBatch,
  enrichPostUseJourneyRecord,
  matchPostUseJourneyFromText,
  isLegacyPostUseKeywordJourney,
  classifyPostUseJourney,
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

  it('needsPostUseJourney for library records still missing a confident journey, including 10-point scores', () => {
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
    ).toBe(true)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'console',
      }),
    ).toBe(true)
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
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 6,
        journeyL1: '未识别环节',
        journeySource: 'post_use_non10',
      }),
    ).toBe(true)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 6,
        journeyL1: '开通',
        journeySource: 'rule',
        journeyMatchScore: 2,
      }),
    ).toBe(true)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 6,
        journeyL1: '开通',
        journeySource: 'rule',
        journeyMatchScore: 3,
      }),
    ).toBe(false)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 6,
        journeyL1: '开通',
        journeySource: 'llm',
      }),
    ).toBe(false)
    const llmUnknown = {
      dataSourceType: 'post_use_rating',
      channel: 'sms',
      ratingScore: 6,
      journeyL1: '未识别环节',
      journeySource: 'llm',
    }
    // 模型已判「未识别环节」：默认不再计入待补全（避免计数死循环、重跑同一批），
    // 仅显式勾选重试时才补
    expect(needsPostUseJourney(llmUnknown)).toBe(false)
    expect(needsPostUseJourney(llmUnknown, undefined, { retryLlmUnknownJourneys: true })).toBe(true)
    expect(needsPostUseJourney({ ...llmUnknown, manualTagFields: ['journey'] }, undefined, { retryLlmUnknownJourneys: true })).toBe(false)
    expect(
      needsPostUseJourney({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 6,
        journeyL1: '',
        manualTagFields: ['journey'],
      }),
    ).toBe(false)
    const legacy = {
      dataSourceType: 'post_use_rating',
      channel: 'sms',
      ratingScore: 6,
      journeyL1: '使用',
      journeySource: 'post_use_non10',
    }
    expect(isLegacyPostUseKeywordJourney(legacy)).toBe(true)
    expect(needsPostUseJourney(legacy)).toBe(false)
    expect(needsPostUseJourney(legacy, undefined, { includeLegacyKeywordJourneys: true })).toBe(true)
    expect(
      needsPostUseJourney(
        { ...legacy, manualTagFields: ['journey'] },
        undefined,
        { includeLegacyKeywordJourneys: true },
      ),
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
      {
        id: 'c',
        dataSourceType: 'post_use_rating',
        channel: 'callback',
        ratingScore: 4,
        rawText: '账号权限',
      },
    ])
    expect(batch.map((item) => item.id)).toEqual(['a', 'b'])
    expect(batch[0].patch.journeyL1).toBe('账号')
    expect(batch[1].patch.journeyL1).toBe('账号')
  })

  it('classifyPostUseJourney 给出待补构成：auto / llm_unknown / legacy / none', () => {
    const base = { dataSourceType: 'post_use_rating', channel: 'sms', ratingScore: 6 }
    // auto：空旅程（未经模型）、规则未识别、规则低分
    expect(classifyPostUseJourney(base)).toBe('auto')
    expect(classifyPostUseJourney({ ...base, journeyL1: '未识别环节' })).toBe('auto')
    expect(classifyPostUseJourney({ ...base, journeyL1: '未识别环节', journeySource: 'rule' })).toBe('auto')
    expect(classifyPostUseJourney({ ...base, journeyL1: '开通', journeySource: 'rule', journeyMatchScore: 2 })).toBe('auto')
    // llm_unknown：模型已判未识别
    expect(classifyPostUseJourney({ ...base, journeyL1: '未识别环节', journeySource: 'llm' })).toBe('llm_unknown')
    // none：模型已写出具体环节、规则分过门闸、人工改过、回访
    expect(classifyPostUseJourney({ ...base, journeyL1: '开通', journeySource: 'llm' })).toBe('none')
    expect(classifyPostUseJourney({ ...base, journeyL1: '开通', journeySource: 'rule', journeyMatchScore: 3 })).toBe('none')
    expect(classifyPostUseJourney({ ...base, manualTagFields: ['journey'] })).toBe('none')
    expect(classifyPostUseJourney({ ...base, channel: 'callback' })).toBe('none')
    // legacy：旧关键词写出的具体环节
    expect(classifyPostUseJourney({ ...base, journeyL1: '使用', journeySource: 'post_use_non10' })).toBe('legacy')
  })
})
