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
  // 11-19 拆批 + 并行化：归类批与文案批并行发起（归类浮签先创建 → 调用序 calls[0]=归类批、calls[1]=文案批）；
  // 归类输出经封闭组过滤 + theme 逐字匹配；非法条目丢弃回退原文自成一档，不阻塞文案批。
  // 11-19 拆批 + 并行化 + L1/L2 体系：归类批输出 {theme,l1,l2}——L1 八类封闭（只选不造），
  // L2 细类开放可空；非法条目丢弃回退原文自成一档，不阻塞文案批。
  it('classifies ungrouped low-score themes via strictLabels and drops forged entries', async () => {
    llmChatCompletion.mockReset()
    // 并行发起序：第一次调用 = 归类批；第二次调用 = 文案批
    llmChatCompletion.mockResolvedValueOnce({ text: JSON.stringify({
      themeGroups: [
        { theme: '垃圾云电脑,不用就关机', l1: '操作与帮助体验' },
        { theme: '页面加载慢/报错', l1: '体验极差类' },
        { theme: '不在清单里的标签', l1: '安全与合规' },
        { theme: '找不到需要的产品/功能', l1: '功能缺失/不完善', l2: '' },
        { theme: 'MOP退订一直失败', l1: '操作执行性能/稳定性不足', l2: 'MOP 退订链路' },
      ],
    }) })
    llmChatCompletion.mockResolvedValueOnce({ text: JSON.stringify({
      focus: [{ index: 0, title: '云监控待回应', detail: '客户反馈批量导出' }],
      products: [{ index: 0, conclusion: '云监控需核实批量导出诉求。' }],
    }) })
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [{ id: 'focus-1', productName: '云监控', theme: '功能有缺失', actionType: '回访跟进', title: '规则标题', detail: '规则事实', text: '核查并回应', priority: 'P0', owner: 'liuhao' }],
      products: [{ name: '云监控', avg: 1, sample: 1, previousAvg: 4.67, status: '重点改善', themes: [] }],
      ungroupedThemes: ['垃圾云电脑,不用就关机', '页面加载慢/报错', '找不到需要的产品/功能', 'MOP退订一直失败'],
    }
    const result = await generatePostUseReportV2Narrative({}, model)
    expect(llmChatCompletion).toHaveBeenCalledTimes(2)
    // 归类批（calls[0]）：判定树 prompt + L1/L2 候选清单进输入 + 4000 预算
    const groupPayload = JSON.parse(llmChatCompletion.mock.calls[0][1].messages[1].content)
    expect(groupPayload.ungroupedThemes).toEqual(['垃圾云电脑,不用就关机', '页面加载慢/报错', '找不到需要的产品/功能', 'MOP退订一直失败'])
    expect(groupPayload.candidateL1).toContain('功能缺失/不完善')
    expect(groupPayload.candidateL2).toContain('MOP 退订链路')
    expect(llmChatCompletion.mock.calls[0][1].max_tokens).toBe(4000)
    // 文案批（calls[1]）：不再携带 ungroupedThemes（拆批瘦身）
    const narrativePayload = JSON.parse(llmChatCompletion.mock.calls[1][1].messages[1].content)
    expect(narrativePayload.ungroupedThemes).toBeUndefined()
    expect(result.themeGroupLabels).toEqual({
      '垃圾云电脑,不用就关机': '操作与帮助体验',
      '找不到需要的产品/功能': '功能缺失/不完善',
      'MOP退订一直失败': '操作执行性能/稳定性不足',
    })
    expect(result.themeL2Labels).toEqual({ 'MOP退订一直失败': 'MOP 退订链路' })
    // 自造 L1（体验极差类）与 theme 越清单（不在清单里的标签）均被丢弃
  })

  it('keeps themeGroupLabels empty when the model returns no grouping', async () => {
    llmChatCompletion.mockReset()
    // 并行发起序：归类批先（空 themeGroups），文案批后
    llmChatCompletion.mockResolvedValueOnce({ text: JSON.stringify({ themeGroups: [] }) })
    llmChatCompletion.mockResolvedValueOnce({ text: JSON.stringify({
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

  // 11-19：归类批失败（网络/解析）不阻塞文案批——themeGroupLabels 空回退
  it('does not fail the narrative batch when the grouping batch errors', async () => {
    llmChatCompletion.mockReset()
    // 并行发起序：归类批先（抛错），文案批后
    llmChatCompletion.mockRejectedValueOnce(new Error('LLM 输出被截断（finish_reason=length），请增大 max_tokens 或缩短输入'))
    llmChatCompletion.mockResolvedValueOnce({ text: JSON.stringify({
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
    expect(result.focus).toBeTruthy()
    expect(result.themeGroupLabels).toEqual({})
  })

  // 11-19 两档剔除·LLM verdicts 第三并行批：evidenceVerdictPending 进输入，封闭集过滤，
  // keep 不存储（默认语义即 keep）；无 pending 时不发起 verdicts 批。
  it('runs the verdicts batch in parallel and filters forged verdicts', async () => {
    llmChatCompletion.mockReset()
    // 并行发起序（三个批均无 pending 依赖时）：verdicts 批先于文案批发起（pendingVerdicts 非空时）
    llmChatCompletion.mockResolvedValueOnce({ text: JSON.stringify({
      verdicts: [
        { id: 'visit-1', verdict: 'no_dissatisfaction' },
        { id: 'visit-2', verdict: 'no_action_needed' },
        { id: 'visit-3', verdict: 'keep' },
        { id: 'visit-4', verdict: '自造判定' },
        { id: 'not-in-pending', verdict: 'no_dissatisfaction' },
      ],
    }) })
    llmChatCompletion.mockResolvedValueOnce({ text: JSON.stringify({
      focus: [{ index: 0, title: '云监控待回应', detail: '客户反馈批量导出' }],
      products: [{ index: 0, conclusion: '云监控需核实批量导出诉求。' }],
    }) })
    const model = {
      kind: 'month', months: ['2026-10'],
      focus: [{ id: 'focus-1', productName: '云监控', theme: '功能有缺失', actionType: '回访跟进', title: '规则标题', detail: '规则事实', text: '核查并回应', priority: 'P0', owner: 'liuhao' }],
      products: [{ name: '云监控', avg: 1, sample: 1, previousAvg: 4.67, status: '重点改善', themes: [] }],
      evidenceVerdictPending: [
        { id: 'visit-1', sourceKind: 'visit', text: '经回访客户说没实际问题' },
        { id: 'visit-2', sourceKind: 'visit', text: '评估为不用优化' },
        { id: 'visit-3', sourceKind: 'visit', text: '客户仍有诉求' },
        { id: 'visit-4', sourceKind: 'visit', text: '待处理' },
      ],
    }
    const result = await generatePostUseReportV2Narrative({}, model)
    // verdicts 批输入含 id + 打码文本
    const verdictPayload = JSON.parse(llmChatCompletion.mock.calls[0][1].messages[1].content)
    expect(verdictPayload.evidence[0]).toMatchObject({ id: 'visit-1', sourceKind: 'visit' })
    // keep 不存储；自造判定丢弃；不在 pending 清单的 id 丢弃
    expect(result.evidenceVerdicts).toEqual({
      'visit-1': 'no_dissatisfaction',
      'visit-2': 'no_action_needed',
    })
  })

  it('skips the verdicts batch when there is no pending evidence', async () => {
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
    const result = await generatePostUseReportV2Narrative({}, model)
    expect(llmChatCompletion).toHaveBeenCalledTimes(1)
    expect(result.evidenceVerdicts).toEqual({})
  })
})
