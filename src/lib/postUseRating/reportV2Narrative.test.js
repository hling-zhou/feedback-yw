import { describe, expect, it, vi } from 'vitest'

const llmChatCompletion = vi.hoisted(() => vi.fn(async (_settings, _body) => ({ text: JSON.stringify({
  focus: [{ index: 0, title: '云监控客户反馈待回应', detail: '客户原话：不支持批量导出' }],
  products: [{ index: 0, conclusion: '云监控本期均分 1 分，需核实批量导出诉求。' }],
  todos: [
    { index: 0, content: '跟进回溯闭环：客户反馈 API 不完善，回溯待完成' },
    { index: 1, content: '' },
    { index: 9, content: 'index 越界应被丢弃' },
  ],
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
    expect(result.todos).toEqual({})
  })

  it('maps todo wording to candidate ids and drops empty or out-of-range entries (11-18)', async () => {
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [],
      products: [],
      todoCandidates: [
        { id: 'todo-trace:t1', sourceKind: 'trace', productName: 'NAT网关', customerMaskedName: '彭****松', status: '待处理', facts: ['客户 彭****松反馈「API 不完善」'] },
        { id: 'todo-visit:v1', sourceKind: 'visit', productName: 'NAT网关', customerMaskedName: '王****', status: '待评估', facts: [] },
      ],
    }
    const result = await generatePostUseReportV2Narrative({}, model)
    expect(result.todos['todo-trace:t1']).toBe('跟进回溯闭环：客户反馈 API 不完善，回溯待完成')
    expect(result.todos).not.toHaveProperty('todo-visit:v1')
    expect(result.todos).not.toHaveProperty('todo-visit:index-9')
  })

  // 11-18 守卫：推理型模型 reasoning 与正文共享 max_tokens 预算，4000 预算下生产
  // 规模输入（99 产品）思考吃光预算（实测 reasoning=4000、text=0）→ finish_reason=length。
  // 契约：① 首选预算 16000（生产规模实测安全值）；② length 截断时升 24000 重试一轮。
  it('requests 16000 token budget and retries at 24000 on length truncation', async () => {
    llmChatCompletion.mockReset()
    const payload = JSON.stringify({
      focus: [{ index: 0, title: '云监控待回应', detail: '客户反馈批量导出' }],
      products: [{ index: 0, conclusion: '云监控需核实批量导出诉求。' }],
    })
    const truncatedOnce = vi.fn()
      .mockResolvedValueOnce({ data: { choices: [{ finish_reason: 'length', message: { content: '' } }] } })
      .mockResolvedValueOnce({ text: payload })
    llmChatCompletion.mockImplementation(truncatedOnce)
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [{ id: 'focus-1', productName: '云监控', theme: '功能有缺失', actionType: '回访跟进', title: '规则标题', detail: '规则事实', text: '核查并回应', priority: 'P0', owner: 'liuhao' }],
      products: [{ name: '云监控', avg: 1, sample: 1, previousAvg: 4.67, status: '重点改善', themes: [] }],
    }
    const result = await generatePostUseReportV2Narrative({}, model)
    const budgets = llmChatCompletion.mock.calls.map((call) => call[1].max_tokens)
    expect(budgets).toEqual([16000, 24000])
    expect(result.focus['focus-1'].title).toContain('待回应')
  })

  it('does not retry when finish_reason is stop', async () => {
    llmChatCompletion.mockReset()
    llmChatCompletion.mockResolvedValue({ text: JSON.stringify({
      focus: [{ index: 0, title: '云监控待回应', detail: '客户反馈批量导出' }],
      products: [{ index: 0, conclusion: '云监控需核实批量导出诉求。' }],
    }) })
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [{ id: 'focus-1', productName: '云监控', theme: '功能有缺失', actionType: '回访跟进', title: '规则标题', detail: '规则事实', text: '核查并回应', priority: 'P0', owner: 'liuhao' }],
      products: [{ name: '云监控', avg: 1, sample: 1, previousAvg: 4.67, status: '重点改善', themes: [] }],
    }
    await generatePostUseReportV2Narrative({}, model)
    expect(llmChatCompletion).toHaveBeenCalledTimes(1)
    expect(llmChatCompletion.mock.calls[0][1].max_tokens).toBe(16000)
  })

  // 11-18 晚 LLM 语义归类（用户拍板"结合 LLM 语义分析做归类"）：
  // ungroupedThemes 进 prompt 输入；themeGroups 输出经封闭组过滤 + theme 逐字匹配；
  // 非法条目（自造组名 / theme 不在未归类清单）丢弃回退原文自成一档，不阻塞文案批。
  it('classifies ungrouped low-score themes via strictLabels and drops forged entries', async () => {
    llmChatCompletion.mockReset()
    llmChatCompletion.mockResolvedValue({ text: JSON.stringify({
      focus: [{ index: 0, title: '云监控待回应', detail: '客户反馈批量导出' }],
      products: [{ index: 0, conclusion: '云监控需核实批量导出诉求。' }],
      themeGroups: [
        { theme: '垃圾云电脑,不用就关机', group: '操作与帮助文档' },
        { theme: '页面加载慢/报错', group: '体验极差类' },
        { theme: '不在清单里的标签', group: '安全类' },
        { theme: '找不到需要的产品/功能', group: '功能缺失/不完善' },
      ],
    }) })
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [{ id: 'focus-1', productName: '云监控', theme: '功能有缺失', actionType: '回访跟进', title: '规则标题', detail: '规则事实', text: '核查并回应', priority: 'P0', owner: 'liuhao' }],
      products: [{ name: '云监控', avg: 1, sample: 1, previousAvg: 4.67, status: '重点改善', themes: [] }],
      ungroupedThemes: ['垃圾云电脑,不用就关机', '页面加载慢/报错', '找不到需要的产品/功能'],
    }
    const result = await generatePostUseReportV2Narrative({}, model)
    const userPayload = JSON.parse(llmChatCompletion.mock.calls[0][1].messages[1].content)
    expect(userPayload.ungroupedThemes).toEqual(['垃圾云电脑,不用就关机', '页面加载慢/报错', '找不到需要的产品/功能'])
    expect(result.themeGroupLabels).toEqual({
      '垃圾云电脑,不用就关机': '操作与帮助文档',
      '找不到需要的产品/功能': '功能缺失/不完善',
    })
    // 自造组名（体验极差类）与 theme 越清单（不在清单里的标签）均被丢弃
  })

  it('keeps themeGroupLabels empty when the model returns no grouping', async () => {
    llmChatCompletion.mockReset()
    llmChatCompletion.mockResolvedValue({ text: JSON.stringify({
      focus: [{ index: 0, title: '云监控待回应', detail: '客户反馈批量导出' }],
      products: [{ index: 0, conclusion: '云监控需核实批量导出诉求。' }],
    }) })
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [{ id: 'focus-1', productName: '云监控', theme: '功能有缺失', actionType: '回访跟进', title: '规则标题', detail: '规则事实', text: '核查并回应', priority: 'P0', owner: 'liuhao' }],
      products: [{ name: '云监控', avg: 1, sample: 1, previousAvg: 4.67, status: '重点改善', themes: [] }],
      ungroupedThemes: ['页面加载慢/报错'],
    }
    const result = await generatePostUseReportV2Narrative({}, model)
    expect(result.themeGroupLabels).toEqual({})
    // 分类批全丢但 focus/products 可用 → 不抛错（回退语义：标签按原文自成一档）
  })
})
