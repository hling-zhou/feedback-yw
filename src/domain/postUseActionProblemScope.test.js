import { describe, expect, it } from 'vitest'
import { buildPostUseActionProblemScope } from './postUseActionProblemScope.js'

/**
 * 用后即评举措聚合问题面（11-27 需求，DESIGN-用后即评举措聚合问题面-20261127）。
 * 关键锚点：① 签名=产品×来源两类，月份不进签名；② 溯源 importMonth 多月份"、"拆分计月
 * （fixture 共谋高发点——实现若直读不拆，"2026-09、2026-10" 会成假月份键）；
 * ③ 最长反馈样例判据；④ linked-only 压降（复用 computeReduction，锚点 scheduleAt-only）。
 */
describe('buildPostUseActionProblemScope', () => {
  // ActionItem 必填最小集（typecheck 零新增；非断言对象只作锚点解析输入）
  const action = (overrides = {}) => /** @type {any} */ ({
    id: 'a1',
    source: 'post_use',
    status: 'in_progress',
    scheduleAt: '2026-03-01',
    completedAt: '',
    ...overrides,
  })

  it('按产品×来源两类分面；月份进趋势不进签名', () => {
    const { problems, anchorMonth, anchorDate } = buildPostUseActionProblemScope(action(), {
      traces: [
        { productName: '云专线', importMonth: '2026-01', customerFeedback: 'a', status: '处理中' },
        { productName: '云专线', importMonth: '2026-02', customerFeedback: 'bb', status: '已处理' },
      ],
      visits: [
        { productName: '云专线', importMonth: '2026-02', userFeedbackText: 'ccc', evaluationSubmitted: true },
      ],
    })
    expect(anchorMonth).toBe('2026-03')
    expect(anchorDate).toBe('2026-03-01')
    expect(problems).toHaveLength(2) // 同产品但来源两类 → 两面
    const traceFace = problems.find((p) => p.sourceKind === 'trace')
    const visitFace = problems.find((p) => p.sourceKind === 'visit')
    expect(traceFace.recordCount).toBe(2)
    expect(traceFace.sourceKindLabel).toBe('产品部溯源')
    expect(traceFace.monthlyTrend).toEqual([
      { date: '2026-01', count: 1 },
      { date: '2026-02', count: 1 },
    ])
    expect(visitFace.recordCount).toBe(1)
    expect(visitFace.statusLabel).toBe('已评估') // 评估状态 Tag（拍板展示）
    // 两面共享锚点 → reduction 各自按面趋势算
    expect(/** @type {any} */ (traceFace.reduction).beforeMonths).toHaveLength(2)
  })

  it('溯源多月份文本拆分计月——一条跨月记录在其覆盖的每月各计 1 条', () => {
    const { problems } = buildPostUseActionProblemScope(action(), {
      traces: [
        { productName: 'NAT网关', importMonth: '2026-09、2026-10', customerFeedback: '跨月行' },
      ],
      visits: [],
    })
    const face = problems[0]
    expect(face.recordCount).toBe(1)
    // 反向 bug 敏感点：不拆分会产出 date="2026-09、2026-10" 的假键或只计 1 个月
    expect(face.monthlyTrend).toEqual([
      { date: '2026-09', count: 1 },
      { date: '2026-10', count: 1 },
    ])
  })

  it('无月份记录计入 recordCount 不进趋势；回访月份取 importMonth || visitMonth', () => {
    const { problems } = buildPostUseActionProblemScope(action(), {
      traces: [{ productName: '云专线', importMonth: '', customerFeedback: '无月记录' }],
      visits: [{ productName: '弹性公网IP', visitMonth: '2026-04', userFeedbackText: '只有回访月' }],
    })
    const traceFace = problems.find((p) => p.sourceKind === 'trace')
    const visitFace = problems.find((p) => p.sourceKind === 'visit')
    expect(traceFace.recordCount).toBe(1)
    expect(traceFace.monthlyTrend).toEqual([])
    expect(traceFace.firstMonth).toBe('')
    // 无趋势但有锚点：reduction 返回对象但 sufficient=false（数据不足）——null 只在无排期时出现
    expect(traceFace.reduction).not.toBeNull()
    expect(/** @type {any} */ (traceFace.reduction).sufficient).toBe(false)
    expect(visitFace.monthlyTrend).toEqual([{ date: '2026-04', count: 1 }])
  })

  it('反馈样例取组内最长文本（信息量最大判据）；溯源细分 plurality', () => {
    const { problems } = buildPostUseActionProblemScope(action(), {
      traces: [
        { productName: '云专线', importMonth: '2026-01', customerFeedback: '短', sourceType: 'questionnaire' },
        { productName: '云专线', importMonth: '2026-02', customerFeedback: '这是更长的一条反馈原文', sourceType: 'callback_non_ten' },
        { productName: '云专线', importMonth: '2026-03', customerFeedback: '中', sourceType: 'questionnaire' },
      ],
      visits: [],
    })
    const face = problems[0]
    expect(face.feedbackSample).toBe('这是更长的一条反馈原文')
    expect(face.subTypeLabel).toBe('问卷类') // 2:1 众数
  })

  it('空关联返回空 problems；锚点口径与工单侧同源（completed 用 completedAt）', () => {
    const empty = buildPostUseActionProblemScope(action(), { traces: [], visits: [] })
    expect(empty.problems).toEqual([])
    expect(empty.anchorMonth).toBe('2026-03')

    const done = buildPostUseActionProblemScope(
      action({ status: 'completed', completedAt: '2026-05-20' }),
      { traces: [{ productName: '云专线', importMonth: '2026-05', customerFeedback: 'x' }], visits: [] },
    )
    expect(done.anchorDate).toBe('2026-05-20') // 实际完成日优先（resolveActionAnchor 复用）
  })
})
