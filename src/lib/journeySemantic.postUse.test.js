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

  it('labels rule (not llm) when the model answer is missing from the parsed payload', async () => {
    // 守卫（失真路径）：LLM 调用成功但解析出的 items 为空（格式漂移/截断/非 JSON），
    // 578 段用 UNKNOWN 占位回退本地重匹配——此时 journeySource 必须标 'rule'。
    // 若误标 'llm'，下游 classifyPostUseJourney 会把「本地重匹配的值」当
    // 「模型已判」→ llm_unknown → 默认永不重试 → 待补全计数静默漂移（11-06 复盘）。
    llmChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({ somethingElse: true }), // 解析成功但无 results
          },
        },
      ],
    })
    const out = await enrichRecordsWithJourneys(
      [
        {
          id: 'p2',
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
    expect(out[0].journeySource).toBe('rule')
    // 本地关键词重匹配给出了目录内有效值（非 UNKNOWN 占位）
    expect(out[0].journeyL1).not.toBe('未识别环节')
  })

  it('keeps llm label when the model explicitly says unknown', async () => {
    // 对照场景：模型对这条真实给出了判断且明说「未识别环节」——这是模型结论，
    // source 必须保留 'llm'（下游判 llm_unknown、默认不重试，四分类语义正确）；
    // 值本身由 606 补偿路径用本地关键词重匹配填充（尽力给值），但不改变
    // 「模型已判」的事实。
    llmChatCompletion.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              results: [{ index: 0, journeyL1: '未识别环节', journeyL2: '未识别子环节' }],
            }),
          },
        },
      ],
    })
    const out = await enrichRecordsWithJourneys(
      [
        {
          id: 'p3',
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
