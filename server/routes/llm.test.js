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
  })

  it('retries without response_format on 400', async () => {
    fetchMock
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
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
})
