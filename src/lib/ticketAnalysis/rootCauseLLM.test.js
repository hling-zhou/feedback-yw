import { describe, expect, it, vi, beforeEach } from 'vitest'
import {
  isValidLlmRootCause,
  truncateRootCause,
  extractRootCauseWithLLM,
  pickLlmRootCauseField,
} from './rootCauseLLM.js'

vi.mock('../themeSemantic.js', () => ({
  canUseSemanticMatch: vi.fn(() => true),
}))

vi.mock('../llmClient.js', () => ({
  llmChatCompletion: vi.fn(),
  getLlmCompletionText: vi.fn(),
  parseLlmMessageContent: vi.fn(),
  isLlmAvailable: vi.fn(() => true),
}))

import { llmChatCompletion, getLlmCompletionText, parseLlmMessageContent } from '../llmClient.js'

const SETTINGS = { llmApiKey: 'sk-test' }

describe('isValidLlmRootCause', () => {
  it('accepts a concrete mechanism', () => {
    expect(isValidLlmRootCause('安全组未放行 22 端口')).toBe(true)
    expect(isValidLlmRootCause('弹性公网 IP 未绑定到云主机')).toBe(true)
    expect(isValidLlmRootCause('异网访问拥塞')).toBe(true)
  })

  it('rejects placeholders', () => {
    expect(isValidLlmRootCause('待分析')).toBe(false)
    expect(isValidLlmRootCause('无法复现')).toBe(false)
    expect(isValidLlmRootCause('根因未明')).toBe(false)
    expect(isValidLlmRootCause('工单未定位到具体问题原因')).toBe(true)
  })

  it('rejects org-blame-only labels', () => {
    expect(isValidLlmRootCause('云能问题')).toBe(false)
    expect(isValidLlmRootCause('产品原因')).toBe(false)
    expect(isValidLlmRootCause('计算部原因')).toBe(false)
  })

  it('rejects tree-path concatenations', () => {
    expect(isValidLlmRootCause('云能问题 / 产品原因 / 计算部原因')).toBe(false)
    expect(isValidLlmRootCause('云能问题/产品原因/计算部原因')).toBe(false)
  })

  it('accepts L3 cause label', () => {
    expect(isValidLlmRootCause('安全策略')).toBe(true)
    expect(isValidLlmRootCause('硬件问题')).toBe(true)
  })

  it('rejects too-short and too-long', () => {
    expect(isValidLlmRootCause('异网')).toBe(false)
    expect(isValidLlmRootCause('x'.repeat(70))).toBe(false)
  })

  it('accepts short L3 labels of 4 chars', () => {
    expect(isValidLlmRootCause('安全策略')).toBe(true)
    expect(isValidLlmRootCause('硬件问题')).toBe(true)
  })
})

describe('pickLlmRootCauseField', () => {
  it('reads rootCause first, then Chinese aliases', () => {
    expect(pickLlmRootCauseField({ rootCause: '安全组未放行 22 端口' })).toBe('安全组未放行 22 端口')
    expect(pickLlmRootCauseField({ 问题原因: '晚高峰异网访问拥塞' })).toBe('晚高峰异网访问拥塞')
    expect(pickLlmRootCauseField({ 根因: '带宽超限' })).toBe('带宽超限')
    expect(pickLlmRootCauseField({ rootCause: '  ', 问题原因: '带宽超限' })).toBe('带宽超限')
    expect(pickLlmRootCauseField({})).toBe('')
  })
})

describe('truncateRootCause', () => {
  it('strips leading field prefixes', () => {
    expect(truncateRootCause('问题原因】：安全组未放行 22 端口')).toBe('安全组未放行 22 端口')
    expect(truncateRootCause('问题原因：带宽超限')).toBe('带宽超限')
    expect(truncateRootCause('根因：MTU 配置错误')).toBe('MTU 配置错误')
    expect(truncateRootCause('原因是安全组未放行')).toBe('安全组未放行')
  })

  it('takes first clause', () => {
    expect(truncateRootCause('安全组未放行 22 端口。已协助放行')).toBe('安全组未放行 22 端口')
  })

  it('truncates to hard max', () => {
    const long = '安全组未放行端口导致客户业务全部中断需要立刻处理才行'
    expect(truncateRootCause(long).length).toBeLessThanOrEqual(60)
  })
})

describe('extractRootCauseWithLLM', () => {
  beforeEach(() => {
    vi.mocked(llmChatCompletion).mockReset()
    vi.mocked(getLlmCompletionText).mockReset()
    vi.mocked(parseLlmMessageContent).mockReset()
  })

  it('cleans before validating: 带前缀的有效成因应被接受（不再被长度误杀）', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({
      rootCause: '问题原因：安全组未放行 22 端口导致公网无法访问',
    })
    const out = await extractRootCauseWithLLM(
      { taggingText: 'x', handlingText: '安全组 22 未开', rootCause: '待分析', painPoint: '公网不通' },
      SETTINGS,
    )
    expect(out).toBe('安全组未放行 22 端口导致公网无法访问')
  })

  it('cleans before validating: 超长有效成因应截断后接受，而非丢弃', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    const longCause =
      '经排查确认安全组未放行 22 端口导致云主机 SSH 无法连接，已在控制台协助客户放行该端口后恢复'
    vi.mocked(parseLlmMessageContent).mockReturnValue({ rootCause: longCause })
    const out = await extractRootCauseWithLLM(
      { taggingText: 'x', handlingText: '安全组 22 未开', rootCause: '待分析', painPoint: '公网不通' },
      SETTINGS,
    )
    // 不应返回空（被旧长度校验丢弃），应返回截断后的首句
    expect(out).toBeTruthy()
    expect(out.length).toBeLessThanOrEqual(60)
    expect(out).toContain('安全组未放行')
  })

  it('accepts Chinese JSON key 问题原因 (model often echoes the prompt label)', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({
      问题原因: '晚高峰异网访问拥塞',
    })
    const out = await extractRootCauseWithLLM(
      { taggingText: 'x', handlingText: '异网', rootCause: '待分析', painPoint: '公网不通' },
      SETTINGS,
    )
    expect(out).toBe('晚高峰异网访问拥塞')
  })

  it('仍拒绝占位/归责树（清洗后仍无效）', async () => {
    vi.mocked(llmChatCompletion).mockResolvedValue({})
    vi.mocked(getLlmCompletionText).mockReturnValue('{}')
    vi.mocked(parseLlmMessageContent).mockReturnValue({ rootCause: '云能问题 / 产品原因 / 计算部原因' })
    const out = await extractRootCauseWithLLM(
      { taggingText: 'x', handlingText: '已建群跟进', rootCause: '待分析', painPoint: '公网不通' },
      SETTINGS,
    )
    expect(out).toBe('')
  })
})
