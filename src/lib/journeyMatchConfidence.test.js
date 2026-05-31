import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  evaluateJourneyGating,
  filterIndicesNeedingJourneyLlm,
  isJourneyLlmGatingEnabled,
} from './journeyMatchConfidence.js'
import { matchJourneyHybridBatch } from './journeySemantic.js'
import { applyManagedTaxonomySnapshot } from './taxonomyLoader.js'

vi.mock('./llmClient.js', () => ({
  llmChatCompletion: vi.fn(),
  getLlmCompletionText: vi.fn(),
  parseLlmMessageContent: vi.fn(),
  isLlmAvailable: vi.fn(() => true),
}))

import {
  llmChatCompletion,
  getLlmCompletionText,
  parseLlmMessageContent,
} from './llmClient.js'

const journeys = [
  {
    id: 'buy',
    label: '购买',
    children: [
      {
        id: 'order',
        label: '下单',
        keywords: ['下单', '购买'],
        description: '客户提交订单',
      },
    ],
  },
  {
    id: 'use',
    label: '业务使用与连通',
    children: [
      {
        id: 'access',
        label: '公网访问不通',
        keywords: ['无法访问', '不通'],
        description: '公网端口访问失败',
      },
    ],
  },
]

const SETTINGS = { llmApiKey: 'sk-test', themeMatchMode: 'hybrid', journeyLlmGating: true }

function seedGenericJourneys() {
  applyManagedTaxonomySnapshot({
    products: {
      generic: {
        key: 'generic',
        name: '通用产品',
        match: [],
        journeys,
        journeyConfigured: true,
      },
    },
    sharedProblemTypes: [],
  })
}

describe('journeyMatchConfidence', () => {
  beforeEach(() => {
    seedGenericJourneys()
  })
  it('G-01: high keyword score skips LLM', () => {
    const text = '工单标题：EIP问题\n详细内容：客户反馈下单流程异常'
    const decision = evaluateJourneyGating(
      text,
      journeys,
      'generic',
      SETTINGS,
      { journeyL1: '购买', journeyL2: '下单' },
    )
    expect(decision.skipLlm).toBe(true)
    expect(decision.reason).toBe('high_confidence')
    expect(decision.score).toBeGreaterThanOrEqual(3)
  })

  it('G-02: unknown journey needs LLM', () => {
    const decision = evaluateJourneyGating(
      '内容完全无关',
      journeys,
      'generic',
      SETTINGS,
      { journeyL1: '未识别环节', journeyL2: '未识别子环节' },
    )
    expect(decision.skipLlm).toBe(false)
    expect(decision.reason).toBe('unknown')
  })

  it('G-03: empty catalog needs LLM', () => {
    const decision = evaluateJourneyGating(
      'test',
      [],
      'generic',
      SETTINGS,
      { journeyL1: '购买', journeyL2: '下单' },
    )
    expect(decision.skipLlm).toBe(false)
    expect(decision.reason).toBe('empty_catalog')
  })

  it('G-04: semantic mode disables gating', () => {
    expect(isJourneyLlmGatingEnabled({ themeMatchMode: 'semantic' })).toBe(false)
    const decision = evaluateJourneyGating(
      '客户反馈下单流程异常',
      journeys,
      'generic',
      { ...SETTINGS, themeMatchMode: 'semantic' },
      { journeyL1: '购买', journeyL2: '下单' },
    )
    expect(decision.skipLlm).toBe(false)
    expect(decision.reason).toBe('forced_semantic')
  })

  it('filterIndicesNeedingJourneyLlm respects gating', () => {
    const texts = [
      '客户反馈下单流程异常',
      '无关内容',
      '公网 IP 无法访问端口',
      '客户再次下单购买',
      'x',
    ]
    const keys = texts.map(() => 'generic')
    const need = filterIndicesNeedingJourneyLlm(texts, keys, SETTINGS)
    expect(need).toContain(1)
    expect(need).toContain(4)
    expect(need).not.toContain(0)
    expect(need).not.toContain(2)
    expect(need).not.toContain(3)
  })

  it('journeyLlmGating=false sends all indices to LLM path', () => {
    const texts = ['客户反馈下单流程异常']
    const need = filterIndicesNeedingJourneyLlm(
      texts,
      ['generic'],
      { ...SETTINGS, journeyLlmGating: false },
    )
    expect(need).toEqual([0])
  })
})

describe('matchJourneyHybridBatch gating', () => {
  beforeEach(() => {
    seedGenericJourneys()
    vi.mocked(llmChatCompletion).mockReset()
    vi.mocked(getLlmCompletionText).mockReset()
    vi.mocked(parseLlmMessageContent).mockReset()
  })

  it('G-05: only non-skipped records invoke LLM in a batch', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({
      results: [
        { index: 0, journeyL1: '购买', journeyL2: '下单' },
        { index: 1, journeyL1: '业务使用与连通', journeyL2: '公网访问不通' },
      ],
    })

    const texts = ['客户反馈下单流程异常', '完全无关的文本', '另一段无关']
    const keys = ['generic', 'generic', 'generic']

    const results = await matchJourneyHybridBatch(texts, keys, SETTINGS, undefined, undefined)

    expect(results[0].journeySource).toBe('rule')
    expect(results[0].journeyL1).toBe('购买')
    expect(results[1].journeySource).toBe('llm')
    expect(results[2].journeySource).toBe('llm')
    expect(llmChatCompletion).toHaveBeenCalledTimes(1)
    const userContent = vi.mocked(llmChatCompletion).mock.calls[0]?.[1]?.messages?.[1]?.content
    expect(String(userContent)).not.toContain('下单流程')
  })
})
