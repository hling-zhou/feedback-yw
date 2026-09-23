import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { llmChatCompletion, setLlmTransport } from '../src/lib/llmClient.js'

vi.mock('./llmConfig.js', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    isLlmConfigured: () => true,
    resolveLlmApiKey: () => 'sk-from-db',
    resolveLlmBaseUrl: () => 'http://gateway.example/aigateway',
    resolveLlmModel: () => 'zhanlu/deepseek-v4-flash',
  }
})

const fetchMock = vi.fn()

beforeEach(async () => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  const { createLlmTransport } = await import('./enrichRunner.js')
  setLlmTransport(createLlmTransport(), { llmServerConfigured: true })
})

afterEach(() => {
  setLlmTransport(null)
  vi.unstubAllGlobals()
})

describe('createLlmTransport', () => {
  it('injects the stored model when settings omit llmModel and drops client baseUrl', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      text: async () => JSON.stringify({ choices: [{ message: { content: 'ok' } }] }),
    })

    await llmChatCompletion(
      { llmModel: '', llmBaseUrl: 'https://client.example/v1' },
      {
        messages: [{ role: 'user', content: 'hi' }],
        model: 'should-not-pass',
        apiKey: 'should-not-pass',
      },
    )

    expect(fetchMock).toHaveBeenCalledWith(
      'http://gateway.example/aigateway/chat/completions',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ Authorization: 'Bearer sk-from-db' }),
      }),
    )
    const sent = JSON.parse(String(fetchMock.mock.calls[0][1].body))
    expect(sent.model).toBe('zhanlu/deepseek-v4-flash')
    expect(sent.baseUrl).toBeUndefined()
    expect(sent.apiKey).toBeUndefined()
    expect(sent.messages).toEqual([{ role: 'user', content: 'hi' }])
  })
})
