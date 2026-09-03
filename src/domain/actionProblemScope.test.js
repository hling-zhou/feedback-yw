import { describe, it, expect } from 'vitest'
import {
  resolveActionAnchor,
  computeReduction,
  buildActionProblemScope,
  buildProblemCentricView,
} from './actionProblemScope.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/** @param {Partial<FeedbackRecord>} over */
function makeRecord(over = {}) {
  return {
    ticketId: 't1',
    productKey: 'eip',
    product: '弹性公网IP',
    journeyL1: '使用',
    journeyL2: '连接',
    problemType: '可用性/连通性故障',
    requestScene: '报障与排错',
    importMonth: '2026-01',
    sentiment: 'negative',
    status: 'open',
    ...over,
  }
}

/** @param {Partial<import('./actionItem.js').ActionItem>} over */
function makeAction(over = {}) {
  return {
    id: 'a1',
    content: '优化EIP连接',
    status: 'in_progress',
    scheduleAt: '2026-03-15',
    firstProposedAt: '2026-02-01',
    linkedTicketIds: [],
    ...over,
  }
}

describe('resolveActionAnchor', () => {
  it('scheduleAt 优先', () => {
    expect(resolveActionAnchor(makeAction({ scheduleAt: '2026-03-15', firstProposedAt: '2026-02-01' })))
      .toEqual({ anchorDate: '2026-03-15', anchorMonth: '2026-03' })
  })
  it('scheduleAt 空则 firstProposedAt 兜底', () => {
    expect(resolveActionAnchor(makeAction({ scheduleAt: '', firstProposedAt: '2026-02-01' })))
      .toEqual({ anchorDate: '2026-02-01', anchorMonth: '2026-02' })
  })
  it('两者皆空返回空', () => {
    expect(resolveActionAnchor(makeAction({ scheduleAt: '', firstProposedAt: '' })))
      .toEqual({ anchorDate: '', anchorMonth: '' })
  })
})

describe('computeReduction', () => {
  const trend = [
    { date: '2026-01', count: 10 },
    { date: '2026-02', count: 12 },
    { date: '2026-03', count: 8 },   // 锚点当月，计入前
    { date: '2026-04', count: 5 },
    { date: '2026-05', count: 4 },
  ]
  it('锚点当月计入前段', () => {
    const r = computeReduction(trend, '2026-03')
    expect(r.beforeMonths.map((m) => m.date)).toEqual(['2026-01', '2026-02', '2026-03'])
    expect(r.afterMonths.map((m) => m.date)).toEqual(['2026-04', '2026-05'])
    expect(r.beforeCount).toBe(30)
    expect(r.afterCount).toBe(9)
    expect(r.beforeAvg).toBe(10)
    expect(r.afterAvg).toBe(4.5)
    expect(r.changePct).toBe(-55)
    expect(r.sufficient).toBe(true)
  })
  it('anchorMonth 空返回 null', () => {
    expect(computeReduction(trend, '')).toBeNull()
  })
  it('前段不足 2 月 → sufficient=false', () => {
    const r = computeReduction([{ date: '2026-03', count: 8 }], '2026-03')
    expect(r.beforeMonths.length).toBe(1)
    expect(r.afterMonths.length).toBe(0)
    expect(r.sufficient).toBe(false)
  })
  it('后段 0 月 → sufficient=false', () => {
    const r = computeReduction(trend, '2026-05')
    expect(r.afterMonths.length).toBe(0)
    expect(r.sufficient).toBe(false)
  })
  it('beforeAvg=0 → changePct=null', () => {
    const r = computeReduction(
      [{ date: '2026-01', count: 0 }, { date: '2026-02', count: 0 }, { date: '2026-03', count: 5 }],
      '2026-02',
    )
    expect(r.beforeAvg).toBe(0)
    expect(r.changePct).toBeNull()
  })
})

describe('buildActionProblemScope', () => {
  it('按 productKey|journeyL1|journeyL2 分组', () => {
    const records = [
      makeRecord({ ticketId: 't1', importMonth: '2026-01', journeyL1: '使用', journeyL2: '连接', problemType: '可用性/连通性故障' }),
      makeRecord({ ticketId: 't2', importMonth: '2026-02', journeyL1: '使用', journeyL2: '连接', problemType: '可用性/连通性故障' }),
      makeRecord({ ticketId: 't3', importMonth: '2026-04', journeyL1: '开通', journeyL2: '配置', problemType: '配置与操作' }),
    ]
    const map = new Map(records.map((r) => [r.ticketId, r]))
    const { problems, anchorMonth } = buildActionProblemScope(
      makeAction({ linkedTicketIds: ['t1', 't2', 't3'] }),
      map,
    )
    expect(anchorMonth).toBe('2026-03')
    expect(problems).toHaveLength(2)
    const conn = problems.find((p) => p.journeyL2 === '连接')
    expect(conn.ticketCount).toBe(2)
    expect(conn.firstMonth).toBe('2026-01')
    expect(conn.lastMonth).toBe('2026-02')
    expect(conn.problemTypeLabel).toBe('可用性/连通性故障')
    expect(conn.reduction).not.toBeNull()
    expect(conn.reduction.beforeMonths.map((m) => m.date)).toEqual(['2026-01', '2026-02'])
  })
  it('无关联工单回退快照单条签名', () => {
    const { problems, anchorMonth } = buildActionProblemScope(
      makeAction({ linkedTicketIds: [], painPointSnapshot: '连接中断', problemTypeSnapshot: '故障', journeyL1Snapshot: '使用', journeyL2Snapshot: '连接' }),
      new Map(),
    )
    expect(problems).toHaveLength(1)
    expect(problems[0].ticketCount).toBe(0)
    expect(problems[0].painPointSample).toBe('连接中断')
    expect(problems[0].reduction).toBeNull()
    expect(anchorMonth).toBe('2026-03')
  })
})

describe('buildProblemCentricView', () => {
  it('仅含有举措的签名；全量趋势 + 多举措叠加', () => {
    const feedbacks = [
      makeRecord({ ticketId: 't1', importMonth: '2026-01', journeyL1: '使用', journeyL2: '连接' }),
      makeRecord({ ticketId: 't2', importMonth: '2026-02', journeyL1: '使用', journeyL2: '连接' }),
      makeRecord({ ticketId: 't3', importMonth: '2026-04', journeyL1: '使用', journeyL2: '连接' }),
      makeRecord({ ticketId: 't4', importMonth: '2026-05', journeyL1: '使用', journeyL2: '连接' }),
      makeRecord({ ticketId: 't5', importMonth: '2026-01', journeyL1: '开通', journeyL2: '配置' }), // 无举措，应被排除
    ]
    const actions = [
      makeAction({ id: 'a1', scheduleAt: '2026-03-01', linkedTicketIds: ['t1', 't2'] }),
      makeAction({ id: 'a2', scheduleAt: '2026-04-10', linkedTicketIds: ['t3'] }),
    ]
    const { problems } = buildProblemCentricView(actions, feedbacks)
    expect(problems).toHaveLength(1)
    const row = problems[0]
    expect(row.journeyL2).toBe('连接')
    expect(row.totalTicketCount).toBe(4)
    expect(row.actions).toHaveLength(2)
    expect(row.actions.map((a) => a.actionId)).toEqual(['a1', 'a2']) // 按 scheduleAt 升序
    expect(row.actions[0].anchorMonth).toBe('2026-03')
    expect(row.actions[0].reduction).not.toBeNull()
    expect(row.overallTrend).toBe('flat') // 首末月均 1 单
  })
  it('overallTrend: 首末月对比', () => {
    const fb = [
      makeRecord({ ticketId: 't1', importMonth: '2026-01', journeyL1: 'A', journeyL2: 'a' }),
      makeRecord({ ticketId: 't2', importMonth: '2026-01', journeyL1: 'A', journeyL2: 'a' }),
      makeRecord({ ticketId: 't3', importMonth: '2026-03', journeyL1: 'A', journeyL2: 'a' }),
      makeRecord({ ticketId: 't4', importMonth: '2026-03', journeyL1: 'A', journeyL2: 'a' }),
      makeRecord({ ticketId: 't5', importMonth: '2026-03', journeyL1: 'A', journeyL2: 'a' }),
    ]
    const actions = [makeAction({ linkedTicketIds: ['t1'] })]
    const { problems } = buildProblemCentricView(actions, fb)
    expect(problems[0].overallTrend).toBe('up') // 2 → 3
  })
})
