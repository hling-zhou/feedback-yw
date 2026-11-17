/**
 * 诊断建议 LLM 生成器单测（11-17）。mock forward 注入，不依赖真实配置。
 */
import { describe, expect, it } from 'vitest'
import { generateDiagnosisSuggestion } from './patrolDiagnosisSuggestion.js'

const mockDeps = (answer) => ({
  llm: {
    apiKey: 'test-key',
    forward: async () => ({ data: { choices: [{ message: { content: answer } }] } }),
  },
})

describe('patrolDiagnosisSuggestion', () => {
  it('正常生成：结论+日志 → 建议文本', async () => {
    const r = await generateDiagnosisSuggestion(
      '该公网IP已绑定资源，不支持绑定其他资源',
      '已绑定资源，不支持绑定其他资源；code=CSLOPENSTACK_NETWORK_IP_BIZ_CONFLICT',
      '资源状态异常',
      mockDeps('建议先在控制台解绑该IP后重试绑定操作；若客户需换绑资源，引导其走解绑-重绑流程。'),
    )
    expect(r).toContain('解绑')
    expect(r?.length).toBeLessThanOrEqual(500)
  })

  it('结论与日志全空 → null 不调 LLM', async () => {
    const forward = { forward: async () => { throw new Error('不应被调') } }
    const r = await generateDiagnosisSuggestion('', '', '', forward)
    expect(r).toBeNull()
  })

  it('LLM 返回 "null" → 视同未生成', async () => {
    const r = await generateDiagnosisSuggestion('有结论', '有日志', '业务冲突', mockDeps('null'))
    expect(r).toBeNull()
  })

  it('LLM 失败（超时）→ null 降级', async () => {
    const r = await generateDiagnosisSuggestion('有结论', '有日志', '业务冲突', {
      llm: { apiKey: 'k', forward: async () => { throw new Error('timeout') } },
    })
    expect(r).toBeNull()
  })

  it('超长建议截断 ≤500 字', async () => {
    const long = '建议' + 'x'.repeat(600)
    const r = await generateDiagnosisSuggestion('有结论', '有日志', '配额不足', mockDeps(long))
    expect(r?.length).toBeLessThanOrEqual(500)
  })
})
