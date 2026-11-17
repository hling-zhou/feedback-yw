import { describe, expect, it, vi } from 'vitest'

const llmChatCompletion = vi.hoisted(() => vi.fn(async (_settings, _body) => ({ text: JSON.stringify({
  focus: [{ index: 0, title: '云监控客户反馈待回应', detail: '客户原话：不支持批量导出' }],
  products: [{ index: 0, conclusion: '云监控本期均分 1 分，需核实批量导出诉求。' }],
}) })))
vi.mock('../llmClient.js', () => ({
  llmChatCompletion,
  getLlmCompletionText: (response) => response.text,
  parseLlmMessageContent: (text) => JSON.parse(text),
}))

import { generatePostUseReportV2Narrative } from './reportV2Narrative.js'

describe('V2 report wording', () => {
  it('requests the report model and returns wording without replacing rule-owned facts', async () => {
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [{ id: 'focus-1', productName: '云监控', theme: '功能有缺失', actionType: '回访跟进', title: '规则标题', detail: '规则事实', text: '核查并回应', priority: 'P0', owner: 'liuhao' }],
      products: [{ name: '云监控', avg: 1, sample: 1, previousAvg: 4.67, status: '重点改善', themes: [{ type: 'low', theme: '功能有缺失', count: 1, lowestScore: 1, lifecycle: '', quotes: ['不支持批量导出'] }] }],
    }
    const result = await generatePostUseReportV2Narrative({}, model)
    expect(llmChatCompletion.mock.calls[0][1].purpose).toBe('report')
    expect(result.focus['focus-1'].title).toContain('待回应')
    expect(result.products['product:云监控']).toContain('批量导出')
    expect(result).not.toHaveProperty('kpis')
    expect(result.focus['focus-1']).not.toHaveProperty('owner')
  })
})
