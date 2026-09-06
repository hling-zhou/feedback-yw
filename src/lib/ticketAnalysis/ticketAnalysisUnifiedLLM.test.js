import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  extractTicketAnalysisUnifiedWithLLM,
  resolveTicketLlmMode,
} from './ticketAnalysisUnifiedLLM.js'

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

const RULE = {
  customerRequest: '规则客户请求：公网 IP 无法访问。',
  painPoint: '安全组未放行导致公网端口无法访问。',
  optimizationProduct: '',
  optimizationService: '',
}

describe('ticketAnalysisUnifiedLLM', () => {
  beforeEach(() => {
    vi.mocked(llmChatCompletion).mockReset()
    vi.mocked(getLlmCompletionText).mockReset()
    vi.mocked(parseLlmMessageContent).mockReset()
  })

  it('resolveTicketLlmMode defaults to unified', () => {
    expect(resolveTicketLlmMode({})).toBe('unified')
    expect(resolveTicketLlmMode({ ticketLlmMode: 'separate' })).toBe('separate')
  })

  it('returns all llm sources when unified response complete', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({
      customerRequest: '多台云主机公网 IP 在晚高峰访问延迟高、页面卡顿。',
      painPoint: '晚高峰公网链路拥塞导致访问延迟高。',
      rootCause: '晚高峰异网访问拥塞',
      productOptimizations: ['控制台增加公网质量诊断与链路拥塞预警看板'],
      serviceOptimizations: [],
    })

    const result = await extractTicketAnalysisUnifiedWithLLM(
      {
        taggingText: '详细内容：延迟大',
        ruleFallback: RULE,
        problemType: '网络质量',
        requestScene: '业务使用',
        journeyL2: '公网访问不通',
      },
      SETTINGS,
    )

    expect(result.customerRequestSource).toBe('llm')
    expect(result.painPointSource).toBe('llm')
    expect(result.rootCauseSource).toBe('llm')
    expect(result.rootCause).toBe('晚高峰异网访问拥塞')
    expect(result.optimizationSource).toBe('llm')
    expect(result.optimizationProduct).toContain('诊断')
    expect(llmChatCompletion).toHaveBeenCalledTimes(1)
    expect(result.optimizationRetry).toBeFalsy()
  })

  it('U-02: optimization retry when unified omits productOptimizations', async () => {
    vi.mocked(llmChatCompletion)
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
      .mockResolvedValueOnce({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent)
      .mockReturnValueOnce({
        customerRequest: '申请提升公网 IP 全局配额上限。',
        painPoint: '默认配额过低导致批量创建失败。',
        rootCause: '默认配额上限过低',
        productOptimizations: [],
        serviceOptimizations: [],
      })
      .mockReturnValueOnce({
        productOptimizations: ['配额中心支持按产品批量申请与审批进度可视化'],
        serviceOptimizations: [],
      })

    const result = await extractTicketAnalysisUnifiedWithLLM(
      {
        taggingText: '详细内容：配额不足',
        ruleFallback: RULE,
      },
      SETTINGS,
    )

    expect(result.customerRequestSource).toBe('llm')
    expect(result.painPointSource).toBe('llm')
    expect(result.rootCauseSource).toBe('llm')
    expect(result.optimizationSource).toBe('llm')
    expect(result.optimizationRetry).toBe(true)
    expect(llmChatCompletion).toHaveBeenCalledTimes(2)
    const thirdCall = vi.mocked(llmChatCompletion).mock.calls[1]?.[1]
    expect(thirdCall?.messages?.[1]?.content).not.toContain('详细内容：配额不足')
  })

  it('falls back to rule when unified fails entirely', async () => {
    vi.mocked(llmChatCompletion).mockRejectedValue(new Error('429'))

    const result = await extractTicketAnalysisUnifiedWithLLM(
      {
        taggingText: 'x',
        ruleFallback: {
          ...RULE,
          optimizationProduct: '规则优化产品建议',
        },
      },
      SETTINGS,
    )

    expect(result.customerRequestSource).toBe('rule')
    expect(result.painPointSource).toBe('rule')
    expect(result.customerRequest).toBe(RULE.customerRequest)
    expect(result.partialFailures?.length).toBeGreaterThan(0)
  })

  it('injects knowledgeSnippets and productName into prompt when provided', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({
      customerRequest: '请求',
      painPoint: '痛点',
      productOptimizations: ['建议'],
      serviceOptimizations: [],
    })

    await extractTicketAnalysisUnifiedWithLLM(
      { taggingText: '带宽超限', ruleFallback: RULE },
      SETTINGS,
      {
        productName: '弹性公网IP',
        knowledgeSnippets: '【eip】独享带宽\n订购流程',
      },
    )

    const call = vi.mocked(llmChatCompletion).mock.calls[0]?.[1]
    const userPrompt = String(call?.messages?.[1]?.content ?? '')
    const systemPrompt = String(call?.messages?.[0]?.content ?? '')
    expect(userPrompt).toContain('产品：弹性公网IP')
    expect(userPrompt).toContain('产品知识库参考')
    expect(userPrompt).toContain('【eip】独享带宽')
    expect(userPrompt).toContain('"rootCause"')
    expect(systemPrompt).toContain('步骤 3 — 问题原因')
    expect(systemPrompt).toContain('四项提取')
  })

  it('omits knowledge section when snippets empty', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({
      customerRequest: '请求',
      painPoint: '痛点',
      productOptimizations: ['建议'],
      serviceOptimizations: [],
    })

    await extractTicketAnalysisUnifiedWithLLM(
      { taggingText: '带宽超限', ruleFallback: RULE },
      SETTINGS,
      { productName: '弹性公网IP', knowledgeSnippets: '' },
    )

    const call = vi.mocked(llmChatCompletion).mock.calls[0]?.[1]
    const userPrompt = String(call?.messages?.[1]?.content ?? '')
    expect(userPrompt).toContain('产品：弹性公网IP')
    expect(userPrompt).not.toContain('产品知识库参考')
  })
})
