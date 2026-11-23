import { describe, expect, it, vi } from 'vitest'

// mock 提升后顶层 await import 执行时序在 vitest 3 有 TDZ 交互坑——mock 实现内置可变返回队列，
// 不依赖 mockResolvedValueOnce（对 vi.fn 的类型推断在 --checkJs 下也报 TS2339，见基线惯例）
const unparseableQueue = []
vi.mock('../llmClient.js', () => ({
  // 11-23 修复后解析链走 getLlmCompletionText——mock 两侧同源（与真实 llmClient 同形：
  // content 字符串正常路径 / 推理型数组形态也覆盖）
  getLlmCompletionText: (data) => {
    const choice = data?.data?.choices ? data.data.choices[0] : data?.choices?.[0]
    const content = choice?.message?.content
    if (typeof content === 'string') return content
    if (Array.isArray(content)) return content.filter((part) => part?.type === 'text').map((part) => part.text).join('')
    return ''
  },
  llmChatCompletion: vi.fn(async () => {
    if (unparseableQueue.length) return unparseableQueue.shift()
    return {
      choices: [{ message: { content: '{"verdicts":[{"index":0,"verdict":"related","reason":"回访处理的是该问题"},{"index":1,"verdict":"no_action","reason":"核实账户异常"},{"index":2,"verdict":"uncertain","reason":"未提及"}]}' } }],
    }
  }),
}))
const { generateIssueLinkVerdicts } = await import('./issueLinkVerdict.js')

describe('issueLinkVerdict LLM parsing', () => {
  it('parses closed-verdict payloads and maps uncertain for missing entries', async () => {
    const issues = [
      { id: 'a', issueName: '功能有缺失', text: '功能有缺失', score: 1, month: '2026-10' },
      { id: 'b', issueName: '页面打开慢', text: '页面打开慢', score: 3, month: '2026-10' },
      { id: 'c', issueName: '价格贵', text: '价格贵', score: 2, month: '2026-10' },
      { id: 'd', issueName: '无法绑定', text: '无法绑定', score: 4, month: '2026-10' },
    ]
    const result = await generateIssueLinkVerdicts({}, { sourceType: 'trace', sourceResult: '经核实账户异常', sourceConclusion: '无需优改' }, issues)
    expect(result.verdicts.map((row) => row.verdict)).toEqual(['related', 'no_action', 'uncertain', 'uncertain'])
    expect(result.verdicts[0].reason).toBe('回访处理的是该问题')
  })
  it('throws on unparseable payload', async () => {
    unparseableQueue.push({ choices: [{ message: { content: 'garbage' } }] })
    await expect(generateIssueLinkVerdicts({}, { sourceType: 'visit', sourceResult: 'x', sourceConclusion: '' }, [{ id: 'a', issueName: 'n', text: 't', score: 1, month: '2026-10' }]))
      .rejects.toThrow('LLM 判定返回无法解析')
  })
})
