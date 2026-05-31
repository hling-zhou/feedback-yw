import { describe, expect, it, vi, beforeEach } from 'vitest'
import { extractCustomerRequestWithLLM, isValidLlmCustomerRequest } from './customerRequestLLM.js'

vi.mock('../llmClient.js', () => ({
  llmChatCompletion: vi.fn(),
  getLlmCompletionText: vi.fn(),
  parseLlmMessageContent: vi.fn(),
  isLlmAvailable: vi.fn(() => true),
}))

import {
  llmChatCompletion,
  getLlmCompletionText,
  parseLlmMessageContent,
} from '../llmClient.js'

const SETTINGS = { llmApiKey: 'sk-test' }

describe('customerRequestLLM', () => {
  beforeEach(() => {
    vi.mocked(llmChatCompletion).mockReset()
    vi.mocked(getLlmCompletionText).mockReset()
    vi.mocked(parseLlmMessageContent).mockReset()
  })

  it('isValidLlmCustomerRequest rejects template content', () => {
    expect(
      isValidLlmCustomerRequest(
        '请求节点：全局流转--业务规则咨询/查询-全局流转工单标题：业务规则咨询/查询-全局流转详细内容：',
      ),
    ).toBe(false)
    expect(isValidLlmCustomerRequest('申请将公网IP全局配额从20提升至300。')).toBe(true)
  })

  it('returns LLM summary when valid', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({
      customerRequest: '每天晚上8-10点，药店访问云服务器延迟大、卡顿。',
    })

    const result = await extractCustomerRequestWithLLM(
      {
        taggingText: '详细内容：客户反馈延迟大',
        candidates: [{ text: '延迟大', phase: 1, order: 0 }],
        ruleFallback: '延迟大',
      },
      SETTINGS,
    )

    expect(result).toMatch(/8-10点|延迟/)
    expect(llmChatCompletion).toHaveBeenCalled()
  })

  it('returns empty when LLM output invalid', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({ customerRequest: 'x' })

    const result = await extractCustomerRequestWithLLM(
      { taggingText: 'test', candidates: [], ruleFallback: '' },
      SETTINGS,
    )
    expect(result).toBe('')
  })
})
