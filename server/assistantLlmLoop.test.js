import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const fetchMock = vi.fn()

beforeEach(() => {
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  process.env.LLM_API_KEY = process.env.LLM_API_KEY || 'test-key'
  process.env.LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.example.com/v1'
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function jsonResponse(body) {
  return {
    ok: true,
    status: 200,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
  }
}

function completion(content) {
  return jsonResponse({
    choices: [{ message: { content } }],
  })
}

describe('runAssistantLoop', () => {
  it('runs list_periods when the gateway body is the tool JSON from the screenshot', async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse('{"tool":"list_periods","args":{}}'))
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  answer: '已查到周期列表',
                  citations: [],
                  links: [],
                }),
              },
            },
          ],
        }),
      )

    const { runAssistantLoop } = await import('./assistantLlmLoop.js')
    const result = await runAssistantLoop({
      question: '本月投诉主要痛点是什么？',
      history: [],
      insightPeriodId: '',
    })

    expect(result.toolsUsed).toContain('list_periods')
    expect(result.answer).toBe('已查到周期列表')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('accepts the same tool call when quotes are fullwidth', async () => {
    const fullwidth = '{\uFF02tool\uFF02:\uFF02list_periods\uFF02,\uFF02args\uFF02:{}}'
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [{ message: { content: fullwidth } }],
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          choices: [
            {
              message: {
                content: '{"answer":"ok","citations":[],"links":[]}',
              },
            },
          ],
        }),
      )

    const { runAssistantLoop } = await import('./assistantLlmLoop.js')
    const result = await runAssistantLoop({
      question: '本月投诉主要痛点是什么？',
      history: [],
      insightPeriodId: '',
    })

    expect(result.toolsUsed).toEqual(['list_periods'])
    expect(result.answer).toBe('ok')
  })

  it('asks for a final answer after four tool rounds', async () => {
    const tool = '{"tool":"list_periods","args":{}}'
    fetchMock
      .mockResolvedValueOnce(completion(tool))
      .mockResolvedValueOnce(completion(tool))
      .mockResolvedValueOnce(completion(tool))
      .mockResolvedValueOnce(completion(tool))
      .mockResolvedValueOnce(completion('{"answer":"7月云专线投诉15件","citations":[],"links":[]}'))

    const { runAssistantLoop } = await import('./assistantLlmLoop.js')
    const result = await runAssistantLoop({
      question: '7月云专线投诉量是多少？',
      history: [],
      insightPeriodId: '',
    })

    expect(result.answer).toBe('7月云专线投诉15件')
    expect(result.toolsUsed).toEqual(['list_periods', 'list_periods', 'list_periods', 'list_periods'])
    expect(fetchMock).toHaveBeenCalledTimes(5)
  })
})
