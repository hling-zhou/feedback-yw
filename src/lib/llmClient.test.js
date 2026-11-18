import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  extractLlmAssistantText,
  getLlmCompletionText,
  isLlmAvailable,
  llmChatCompletion,
  normalizeLlmBaseUrl,
  parseLlmMessageContent,
  parseLlmResponseBody,
  refreshLlmServerStatus,
  resolvePayloadModel,
} from './llmClient.js'

vi.mock('./apiClient.js', () => ({
  apiFetch: vi.fn(),
}))

import { apiFetch } from './apiClient.js'

afterEach(() => {
  vi.mocked(apiFetch).mockReset()
})

describe('normalizeLlmBaseUrl', () => {
  it('normalizes base url', () => {
    expect(normalizeLlmBaseUrl('https://api.openai.com/v1/')).toBe('https://api.openai.com/v1')
  })
})

describe('isLlmAvailable', () => {
  it('is true when server cache is configured', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ configured: true })
    await refreshLlmServerStatus()
    expect(isLlmAvailable({ llmServerConfigured: false })).toBe(true)
  })

  it('is true when settings.llmServerConfigured is true', () => {
    expect(isLlmAvailable({ llmServerConfigured: true })).toBe(true)
  })

  it('is false when no key and server not configured', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ configured: false })
    await refreshLlmServerStatus()
    expect(isLlmAvailable({ llmServerConfigured: false })).toBe(false)
  })
})

describe('extractLlmAssistantText', () => {
  it('prefers content over reasoning_content', () => {
    expect(
      extractLlmAssistantText({
        content: '{"ok":true}',
        reasoning_content: '思考过程',
      }),
    ).toBe('{"ok":true}')
  })

  it('falls back to reasoning_content when content is empty', () => {
    expect(
      extractLlmAssistantText({
        content: '',
        reasoning_content: '{"measures":["a"]}',
      }),
    ).toBe('{"measures":["a"]}')
  })
})

describe('getLlmCompletionText', () => {
  it('reads glm-style completion payload', () => {
    const text = getLlmCompletionText({
      choices: [
        {
          message: {
            content: '你好',
            reasoning_content: '思考…',
          },
        },
      ],
    })
    expect(text).toBe('你好')
  })

  // 11-18 守卫：推理型模型 reasoning 与正文共享 max_tokens 预算，length 截断时
  // content 为空、reasoning_content 是思考半成品。旧实现把思考草稿当正文返回，
  // 下游「不是合法 JSON」报错内容失真成思考文本（报告文案线上事故实证）。
  // 契约：截断态只认 content / choice.text，思考草稿不得冒充正文；正文空则抛
  // 明确截断错误，不流入解析层。
  it('length-truncated thinking model: reasoning draft must not masquerade as content', () => {
    const data = {
      choices: [
        {
          finish_reason: 'length',
          message: {
            content: '',
            reasoning_content: 'We need produce JSON only. {"focus":[{"index":0,"title":"半截',
          },
        },
      ],
    }
    expect(() => getLlmCompletionText(data)).toThrow(/截断/)
  })

  it('length-truncated but content has text: returns content as-is', () => {
    const data = {
      choices: [
        {
          finish_reason: 'length',
          message: {
            content: '{"focus":[{"index":0,"title":"写了一半',
            reasoning_content: '思考草稿…',
          },
        },
      ],
    }
    // 正文非空截断：原样返回，由消费方按 finish_reason/解析层处理（如 askLlm 升预算重试）
    expect(getLlmCompletionText(data)).toBe('{"focus":[{"index":0,"title":"写了一半')
  })

  it('stop-finished thinking model still falls back to reasoning_content', () => {
    const data = {
      choices: [
        {
          finish_reason: 'stop',
          message: {
            content: '',
            reasoning_content: '{"measures":["a"]}',
          },
        },
      ],
    }
    // 正常收尾的思考模型兜底契约不变（contentToText 空、思考有值 → 返回思考）
    expect(getLlmCompletionText(data)).toBe('{"measures":["a"]}')
  })

  it('data.choices nested gateway payload keeps working', () => {
    const text = getLlmCompletionText({
      data: { choices: [{ message: { content: '网关嵌套' } }] },
    })
    expect(text).toBe('网关嵌套')
  })
})

describe('parseLlmResponseBody', () => {
  it('parses a tool call exactly', () => {
    expect(parseLlmResponseBody('{"tool":"list_periods","args":{}}')).toEqual({
      tool: 'list_periods',
      args: {},
    })
  })

  it('parses tool calls wrapped in smart quotes, BOM, or a think tag', () => {
    expect(parseLlmResponseBody('\uFEFF<think>先查周期</think>\n{"tool":"list_periods","args":{}}')).toEqual({
      tool: 'list_periods',
      args: {},
    })
    expect(parseLlmResponseBody('{"tool":"list_periods","args":{},}')).toEqual({
      tool: 'list_periods',
      args: {},
    })
    expect(parseLlmResponseBody('{\u201Ctool\u201D:\u201Clist_periods\u201D,\u201Cargs\u201D:{}}')).toEqual({
      tool: 'list_periods',
      args: {},
    })
    expect(parseLlmResponseBody('{\uFF02tool\uFF02:\uFF02list_periods\uFF02,\uFF02args\uFF02:{}}')).toEqual({
      tool: 'list_periods',
      args: {},
    })
  })

  it('unwraps a double-encoded JSON string', () => {
    expect(parseLlmResponseBody(JSON.stringify('{"tool":"list_periods","args":{}}'))).toEqual({
      tool: 'list_periods',
      args: {},
    })
  })

  it('keeps the complete answer when a truncated JSON prefix is glued in front', () => {
    const raw =
      '{"answer":"202{"answer":"2026年7月云专线投诉量为15件（该月投诉工单总量为159件，云专线占比约9.4%）。","citations":[],"links":[{"kind":"feedbacks","params":{"source":"complaint_ticket"}}]}'
    expect(parseLlmResponseBody(raw)).toEqual({
      answer: '2026年7月云专线投诉量为15件（该月投诉工单总量为159件，云专线占比约9.4%）。',
      citations: [],
      links: [{ kind: 'feedbacks', params: { source: 'complaint_ticket' } }],
    })
  })

  it('reads content arrays', () => {
    expect(
      extractLlmAssistantText({
        content: [{ type: 'text', text: '{"tool":"list_periods","args":{}}' }],
      }),
    ).toBe('{"tool":"list_periods","args":{}}')
  })
})

describe('parseLlmMessageContent', () => {
  it('parses json inside closed fence', () => {
    expect(parseLlmMessageContent('```json\n{"measures":["x"]}\n```')).toEqual({
      measures: ['x'],
    })
  })

  it('parses json when only opening fence is present', () => {
    expect(parseLlmMessageContent('```json\n{"measures":["优化A"]}')).toEqual({
      measures: ['优化A'],
    })
  })
})

describe('refreshLlmServerStatus', () => {
  it('caches configured flag from API', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ configured: true })
    await expect(refreshLlmServerStatus()).resolves.toBe(true)
    expect(isLlmAvailable()).toBe(true)
  })

  it('returns false when status request fails', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('network'))
    await expect(refreshLlmServerStatus()).resolves.toBe(false)
    expect(isLlmAvailable()).toBe(false)
  })
})

describe('resolvePayloadModel', () => {
  it('uses settings.llmModel when set', () => {
    expect(resolvePayloadModel({ llmModel: 'Deepseek-V3' })).toBe('Deepseek-V3')
  })

  it('returns undefined when settings model is empty (server uses LLM_MODEL)', () => {
    expect(resolvePayloadModel({ llmModel: '' })).toBeUndefined()
    expect(resolvePayloadModel({})).toBeUndefined()
  })
})

describe('llmChatCompletion', () => {
  it('omits baseUrl and model when settings fields are empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })
    await llmChatCompletion({ llmBaseUrl: '', llmModel: '' }, { messages: [{ role: 'user', content: 'hi' }] })
    const [, init] = vi.mocked(apiFetch).mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body).not.toHaveProperty('baseUrl')
    expect(body).not.toHaveProperty('model')
  })

  it('ignores legacy gpt-4o-mini in body when settings model is empty', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })
    await llmChatCompletion(
      { llmModel: '' },
      { model: 'gpt-4o-mini', messages: [{ role: 'user', content: 'hi' }] },
    )
    const [, init] = vi.mocked(apiFetch).mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body).not.toHaveProperty('model')
  })

  it('sends normalized baseUrl and model when set in settings', async () => {
    vi.mocked(apiFetch).mockResolvedValue({ choices: [{ message: { content: 'ok' } }] })
    await llmChatCompletion(
      { llmBaseUrl: 'https://api.example.com/v1/', llmModel: 'test-model' },
      { messages: [{ role: 'user', content: 'hi' }] },
    )
    const [, init] = vi.mocked(apiFetch).mock.calls[0]
    const body = JSON.parse(String(init?.body))
    expect(body.baseUrl).toBe('https://api.example.com/v1')
    expect(body.model).toBe('test-model')
  })
})

describe('parseLlmMessageContent 批结果容器契约（82742ef 剥包装回归守卫）', () => {
  // 打标类消费方（journeySemantic/themeSemantic/keywordLlmFilter 等）的提示词约定
  // 模型返回 {"results":[...]} 包装。82742ef 起 pickAssistantPayload 会把这类容器
  // 剥成元素本身/只剩最后一个元素 → parsed.results 恒 undefined → 批量答案整体丢失
  // → 全部回退本地重匹配且被误标 journeySource='llm' → 下游 llm_unknown 判定失真
  // → 待补全计数死循环以另一形态复活。本守卫锁「批容器必须原样保留」契约。
  /** @param {unknown} parsed @returns {Record<string, any>} */
  const asResults = (parsed) => /** @type {Record<string, any>} */ (parsed)
  it('单元素 results 容器保留包装（不解成元素本身）', () => {
    const parsed = asResults(parseLlmMessageContent(
      JSON.stringify({ results: [{ index: 0, journeyL1: '产品订改续', journeyL2: '权限及配额限制' }] }),
    ))
    expect(Array.isArray(parsed?.results)).toBe(true)
    expect(parsed.results[0].journeyL1).toBe('产品订改续')
  })

  it('多元素 results 容器一个不丢（不只剩最后一个）', () => {
    const parsed = asResults(parseLlmMessageContent(
      JSON.stringify({
        results: [
          { index: 0, journeyL1: '产品订改续', journeyL2: '权限及配额限制' },
          { index: 1, journeyL1: '业务使用与连通', journeyL2: '公网访问不通' },
        ],
      }),
    ))
    expect(parsed?.results?.length).toBe(2)
    expect(parsed.results[0].journeyL1).toBe('产品订改续')
    expect(parsed.results[1].journeyL1).toBe('业务使用与连通')
  })

  it('fence 包裹的 results 容器同样保留', () => {
    const content = '```json\n' + JSON.stringify({
      results: [{ index: 0, journeyL1: '产品订改续', journeyL2: '权限及配额限制' }],
    }) + '\n```'
    const parsed = asResults(parseLlmMessageContent(content))
    expect(Array.isArray(parsed?.results)).toBe(true)
  })

  // 11-08 会诊 P2-2：llmRecommend（topicAnalysis 专题推荐）prompt 承诺 {"cards":[...]}
  // （最多 20 张卡片批容器）——batchKeysGuard 扫出 cards 不在白名单（粘连场景下
  // 启发式可能剥掉容器），按守卫处置方案① 入表 + 本契约用例。
  it('cards 批容器（llmRecommend 专题推荐）保留包装', () => {
    const parsed = asResults(parseLlmMessageContent(
      JSON.stringify({
        cards: [
          { id: 'topic-1', mergeIds: [], intro: '简介A', whyNow: '理由A' },
          { id: 'topic-2', mergeIds: ['topic-3'], intro: '简介B', whyNow: '理由B' },
        ],
      }),
    ))
    expect(Array.isArray(parsed?.cards)).toBe(true)
    expect(parsed.cards.length).toBe(2)
    expect(parsed.cards[1].mergeIds[0]).toBe('topic-3')
  })

  it('assistant 粘连场景不回归：半截+完整 answer 仍取最后完整对象', () => {
    const content = '{"answer":"前半截' + JSON.stringify({ answer: '完整答案', citations: [] })
    const parsed = asResults(parseLlmMessageContent(content))
    expect(parsed?.answer).toBe('完整答案')
  })

  it('assistant tools 批容器形态不受影响', () => {
    const parsed = asResults(parseLlmMessageContent(
      JSON.stringify({ tools: [{ tool: 'search_records', args: {} }] }),
    ))
    expect(Array.isArray(parsed?.tools)).toBe(true)
  })

  // 11-18 报告 V2 容器入表（batchKeysGuard 处置方案① 先例）：reportV2Narrative prompt
  // 承诺 {"focus":[...],"products":[...],"todos":[...]}，不入白名单时被
  // pickAssistantPayload「取最后对象」启发式剥掉包装 → 99 产品只剩 {"index":98,...}
  // →「报告模型未返回完整文案」批量丢失（真实链路实证）。入表后从后往前扫，
  // 唯一含数组字段的完整对象是外层容器本身，正确保留。
  it('报告 V2 容器（focus/products/todos）保留包装不取内部子对象', () => {
    const content = JSON.stringify({
      focus: [{ index: 0, title: '云监控待回应', detail: '客户反馈批量导出' }],
      products: [
        { index: 0, conclusion: '云监控需核实批量导出诉求。' },
        { index: 1, conclusion: '账号中心持续观察。' },
      ],
      todos: [{ index: 0, content: '跟进回溯闭环' }],
    })
    const parsed = asResults(parseLlmMessageContent(content))
    expect(Array.isArray(parsed?.focus)).toBe(true)
    expect(Array.isArray(parsed?.products)).toBe(true)
    expect(parsed?.products?.length).toBe(2)
    expect(parsed.products[1].conclusion).toBe('账号中心持续观察。')
    expect(Array.isArray(parsed?.todos)).toBe(true)
  })

  // 11-18 晚 themeGroups 入表同先例：reportV2Narrative 语义归类批容器（LLM 把未命中
  // 正则的低分标签归入封闭组），与 focus/products/todos 同批返回。
  it('报告 V2 语义归类容器（themeGroups）与文案容器同批保留', () => {
    const content = JSON.stringify({
      focus: [{ index: 0, title: '待回应', detail: '客户反馈功能缺失' }],
      products: [{ index: 0, conclusion: '需核实。' }],
      themeGroups: [
        { theme: '垃圾云电脑,不用就关机', group: '操作与帮助文档' },
        { theme: '烂到极致，我要退款', group: '操作与帮助文档' },
      ],
    })
    const parsed = asResults(parseLlmMessageContent(content))
    expect(Array.isArray(parsed?.themeGroups)).toBe(true)
    expect(parsed?.themeGroups?.length).toBe(2)
    expect(parsed.themeGroups[1].theme).toBe('烂到极致，我要退款')
  })

  // 11-18 llmBrief 叙事容器入表：输出契约 {"narrative":...,"whyHappenedNarrative":...,
  // "recommendations":[...],"sourceIds":[...]}，不入白名单时被「取最后对象」剥成最后一个
  // {"id":"r2","text":...} 子对象 → narrative/whyHappenedNarrative 整体丢失（真实链路
  // 实证：旧 1600 截断时代解析直接抛错走 fallback 掩盖了剥离；8192 后正文完整产出，
  // 剥离才显形——llmApplied=true 但 narrative 空串，最隐蔽的一类静默劣化）。
  it('llmBrief 叙事容器（narrative/recommendations）保留包装不取末位子对象', () => {
    const content = JSON.stringify({
      narrative: '月末出账时段带宽计费争议集中，客户对计费规则理解存在偏差。',
      whyHappenedNarrative: '推测为计费说明文案歧义导致客户预期与账单不一致（假设，待验证）。',
      recommendations: [
        { id: 'r1', text: '优化账单页计费明细展示' },
        { id: 'r2', text: '复核计费说明文案' },
      ],
      sourceIds: ['s0', 's1'],
    })
    const parsed = asResults(parseLlmMessageContent(content))
    expect(typeof parsed?.narrative).toBe('string')
    expect(parsed.narrative).toContain('带宽计费争议')
    expect(typeof parsed?.whyHappenedNarrative).toBe('string')
    expect(Array.isArray(parsed?.recommendations)).toBe(true)
    expect(parsed.recommendations.length).toBe(2)
    expect(parsed.recommendations[1].text).toBe('复核计费说明文案')
  })
})
