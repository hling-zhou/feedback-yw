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
})
