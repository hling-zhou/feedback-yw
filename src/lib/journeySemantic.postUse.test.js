import { beforeEach, describe, expect, it, vi } from 'vitest'
import { enrichRecordsWithJourneys } from './journeySemantic.js'

const llmChatCompletion = vi.fn()

vi.mock('./llmClient.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    llmChatCompletion: (...args) => llmChatCompletion(...args),
  }
})

const keywordSettings = {
  themeMatchMode: 'keyword',
  llmServerConfigured: true,
  journeyLlmGating: true,
  journeyLlmSkipScoreThreshold: 999,
  useRequestNodeForJourney: false,
}

describe('post-use journey gating under keyword mode', () => {
  beforeEach(() => {
    llmChatCompletion.mockReset()
    llmChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [{ index: 0, journeyL1: '产品订改续', journeyL2: '权限及配额限制' }],
            }),
          },
        },
      ],
    })
  })

  it('calls the model for a low-score post-use journey even when theme match is keyword', async () => {
    const out = await enrichRecordsWithJourneys(
      [
        {
          id: 'p1',
          dataSourceType: 'post_use_rating',
          channel: 'sms',
          ratingScore: 6,
          product: '弹性公网IP',
          productKey: 'eip',
          journeyL1: '业务使用与连通',
          journeyL2: '公网访问不通或不稳定、丢包',
          journeySource: 'rule',
          journeyMatchScore: 1,
          scene: '资源创建后',
          commentText: '配额不够',
        },
      ],
      keywordSettings,
    )
    expect(llmChatCompletion).toHaveBeenCalled()
    expect(out[0].journeySource).toBe('llm')
    expect(out[0].journeyL1).toBe('产品订改续')
    expect(out[0].journeyL2).toBe('权限及配额限制')
  })

  it('does not call the model for a ticket just because theme match is keyword', async () => {
    const out = await enrichRecordsWithJourneys(
      [
        {
          id: 't1',
          dataSourceType: 'complaint_ticket',
          product: '弹性公网IP',
          productKey: 'eip',
          journeyL1: '业务使用与连通',
          journeyL2: '公网访问不通或不稳定、丢包',
          journeySource: 'rule',
          journeyMatchScore: 1,
          customerRequest: '配额不够',
        },
      ],
      keywordSettings,
    )
    expect(llmChatCompletion).not.toHaveBeenCalled()
    expect(out[0].journeyL1).toBe('业务使用与连通')
    expect(out[0].journeySource).toBe('rule')
  })
})
