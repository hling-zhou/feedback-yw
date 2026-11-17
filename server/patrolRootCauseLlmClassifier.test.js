/**
 * LLM 根因兜底分类器单测（11-17）。
 * 注入 mock forward——不依赖真实 LLM 配置；「无配置」用例 vi.mock llmConfig。
 */
import { describe, expect, it, vi } from 'vitest'
import { classifyRootCauseByLlm, LLM_ROOT_CAUSE_L1_OPTIONS } from './patrolRootCauseLlmClassifier.js'

const mockForwardOk = (answer) => async () => ({
  data: { choices: [{ message: { content: answer } }] },
})
const apiDeps = (answer) => ({
  llm: {
    apiKey: 'test-key',
    forward: mockForwardOk(answer),
  },
})

describe('patrolRootCauseLlmClassifier', () => {
  it('枚举值域 = 7 类（与规则表 L1 值域一致）', () => {
    expect(LLM_ROOT_CAUSE_L1_OPTIONS).toHaveLength(7)
    expect(LLM_ROOT_CAUSE_L1_OPTIONS).toContain('其他/未归类')
  })

  it('LLM 选类：正常调用日志 → 诊断能力缺口（byLlm=true）', async () => {
    const r = await classifyRootCauseByLlm('调用方法: execution(ReturnMessage xxx)；记录request信息', apiDeps('诊断能力缺口'))
    expect(r.l1).toBe('诊断能力缺口')
    expect(r.byLlm).toBe(true)
  })

  it('LLM 选类带前后缀噪声 → 最长枚举命中', async () => {
    const r = await classifyRootCauseByLlm('该资源不存在', apiDeps('根因是：资源状态异常。请参考。'))
    expect(r.l1).toBe('资源状态异常')
    expect(r.byLlm).toBe(true)
  })

  it('LLM 判「其他/未归类」→ byLlm=false（保持兜底语义）', async () => {
    const r = await classifyRootCauseByLlm('含糊文本', apiDeps('其他/未归类'))
    expect(r.l1).toBe('其他/未归类')
    expect(r.byLlm).toBe(false)
  })

  it('LLM 输出不在枚举内（编造类目）→ 拒绝，保持兜底', async () => {
    const r = await classifyRootCauseByLlm('含糊文本', apiDeps('网络抖动类'))
    expect(r.l1).toBe('其他/未归类')
    expect(r.byLlm).toBe(false)
  })

  it('LLM 调用失败（超时/异常）→ 降级保持兜底', async () => {
    const r = await classifyRootCauseByLlm('任意文本', {
      llm: { apiKey: 'k', forward: async () => { throw new Error('timeout') } },
    })
    expect(r.l1).toBe('其他/未归类')
    expect(r.byLlm).toBe(false)
  })

  it('无 LLM 配置（resolveLlmApiKey 抛错）→ 保持兜底', async () => {
    vi.doMock('./llmConfig.js', () => ({
      resolveLlmApiKey: () => { throw new Error('未设置 LLM_API_KEY') },
      resolveLlmBaseUrl: () => 'http://x',
      resolveLlmModel: () => 'm',
    }))
    vi.resetModules()
    const { classifyRootCauseByLlm: fresh } = await import('./patrolRootCauseLlmClassifier.js')
    const r = await fresh('任意文本', {})
    expect(r.l1).toBe('其他/未归类')
    expect(r.byLlm).toBe(false)
    vi.doUnmock('./llmConfig.js')
    vi.resetModules()
  })

  it('空文本 → 直接兜底不调 LLM', async () => {
    const forward = vi.fn(async () => ({ data: { choices: [{ message: { content: '业务冲突' } }] } }))
    const r = await classifyRootCauseByLlm('', { llm: { apiKey: 'k', forward } })
    expect(r.l1).toBe('其他/未归类')
    expect(forward).not.toHaveBeenCalled()
  })
})
