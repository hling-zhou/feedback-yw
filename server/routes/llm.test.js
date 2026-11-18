import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('forwardLlmChatCompletion', () => {
  // 11-18 注：该用例实测耗时随本机网络状态在 0.3~7s 浮动（stubGlobal 后仍偶发慢，
  // 疑与首次 import 链路图 transform 相关），默认 5s 临界导致偶发超时假红——放宽到 15s
  // 只影响本用例计时上限，断言不变。
  it('forwards chat completion to upstream', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () =>
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
        }),
    })

    const { forwardLlmChatCompletion } = await import('../llmProxy.js')
    const data = await forwardLlmChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      body: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
      },
    })

    expect(data.choices[0].message.content).toContain('ok')
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example.com/v1/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-test',
        }),
      }),
    )
  }, 15_000)

  // 11-18 守卫：打标批处理线（journeySemantic/themeSemantic/observation 等）不显式传
  // max_tokens，全吃 llmProxy 兜底默认。推理型模型 reasoning 与正文共享预算，实测 10 条批
  // reasoning=1327——兜底若被改回小值（或误删），批处理线将在批大小放大时静默截断
  //（解析必败回退本地 + journeySource 标注失真，82742ef 同款事故形态）。锁契约 ≥4096。
  // 注：用「本用例发起后的新增调用数」定位，不按全局序号——前用例超时重试会让序号漂移。
  it('applies a batch-safe default token budget when max_tokens is not provided', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: '{}' } }] }),
    })
    const { forwardLlmChatCompletion } = await import('../llmProxy.js')
    const callsBefore = fetchMock.mock.calls.length

    await forwardLlmChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      body: { model: 'm', messages: [{ role: 'user', content: 'ping' }] },
    })
    const defaultBody = JSON.parse(fetchMock.mock.calls[callsBefore][1].body)
    expect(defaultBody.max_tokens).toBeGreaterThanOrEqual(4096)

    // 显式传值不受兜底覆盖（调用方自主标定优先）
    await forwardLlmChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      body: { model: 'm', messages: [], max_tokens: 128 },
    })
    const explicitBody = JSON.parse(fetchMock.mock.calls[fetchMock.mock.calls.length - 1][1].body)
    expect(explicitBody.max_tokens).toBe(128)
  })

  it.each([400, 422])('retries without response_format on %i', async (status) => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status,
        text: async () => JSON.stringify({ error: { message: 'json_object not supported' } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        text: async () =>
          JSON.stringify({
            choices: [{ message: { content: '{"ok":true}' } }],
          }),
      })

    const { forwardLlmChatCompletion } = await import('../llmProxy.js')
    const data = await forwardLlmChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      body: {
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: 'ping' }],
        response_format: { type: 'json_object' },
      },
    })

    expect(data.choices[0].message.content).toContain('ok')
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const secondBody = JSON.parse(String(fetchMock.mock.calls[1][1].body))
    expect(secondBody.response_format).toBeUndefined()
  })

  it('wraps a raw tool JSON body as a chat completion', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '{"tool":"list_periods","args":{}}',
    })

    const { forwardLlmChatCompletion } = await import('../llmProxy.js')
    const data = await forwardLlmChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      body: { model: 'zhanlu/deepseek-v4-flash', messages: [] },
    })

    expect(JSON.parse(data.choices[0].message.content)).toEqual({
      tool: 'list_periods',
      args: {},
    })
  })

  it('accepts a tool JSON body with trailing comma', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => '{"tool":"list_periods","args":{},}',
    })

    const { forwardLlmChatCompletion } = await import('../llmProxy.js')
    const data = await forwardLlmChatCompletion({
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-test',
      body: { model: 'zhanlu/deepseek-v4-flash', messages: [] },
    })

    expect(JSON.parse(data.choices[0].message.content).tool).toBe('list_periods')
  })
})
