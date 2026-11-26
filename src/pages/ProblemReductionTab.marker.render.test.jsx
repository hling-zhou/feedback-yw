import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// 捕获 TrendChart 的 referenceLines 传参——recharts SSR 空壳渲染不到 SVG 细节，
// 竖线聚合形态（几条线、badge 值）在这里以序列化形态锚定，红绿可达。
vi.mock('../components/charts/TrendChart.jsx', () => ({
  default: function MockTrendChart(props) {
    return React.createElement('div', {
      'data-testid': 'trend-chart',
      'data-reference-lines': JSON.stringify(props.referenceLines ?? null),
    })
  },
}))

import { ProblemDetail } from './ProblemReductionTab.jsx'

/** 真库形态样例：同月 3 条（含同日 2 条）、次月 1 条、无排期 1 条 */
const ROW = {
  key: 'eip|使用|连接',
  productKey: 'eip',
  productName: '弹性公网IP',
  journeyL1: '使用',
  journeyL2: '连接',
  problemTypeLabel: '可用性/连通性故障',
  requestSceneLabel: '',
  painPointSample: '连接中断频繁',
  totalTicketCount: 4,
  firstMonth: '2026-01',
  lastMonth: '2026-05',
  overallTrend: 'down',
  monthlyTrend: [
    { date: '2026-01', count: 2, negative: 1 },
    { date: '2026-02', count: 2, negative: 1 },
    { date: '2026-03', count: 1, negative: 0 },
    { date: '2026-04', count: 1, negative: 0 },
    { date: '2026-05', count: 0, negative: 0 },
  ],
  actions: [
    // 同月 3 条（含同日 2 条）→ 图上只应有 1 条竖线、角标 3、徽标序号 1
    // 状态形态：a1 已完成 + a2/a3 逾期未完成 → 该月 tone=overdue（红，含逾期优先）
    // reduction 形态对齐生产：有 anchorMonth 时 computeReduction 恒返回对象（此处 sufficient=false → “数据不足”）
    { actionId: 'a1', content: '优化连接', scheduleAt: '2026-03-15', status: 'completed', completedAt: '2026-03-15', anchorDate: '2026-03-15', anchorMonth: '2026-03', reduction: { sufficient: false } },
    { actionId: 'a2', content: '升级内核', scheduleAt: '2026-03-20', status: 'in_progress', anchorDate: '2026-03-20', anchorMonth: '2026-03', reduction: { sufficient: false } },
    { actionId: 'a3', content: '扩容网关', scheduleAt: '2026-03-15', status: 'suspended', anchorDate: '2026-03-15', anchorMonth: '2026-03', reduction: { sufficient: false } },
    // 有排期第 2 月 → 徽标序号 2（sufficient 数据 → 前后对比文案）；状态 completed → tone=done（绿）
    { actionId: 'a4', content: '增加冗余', scheduleAt: '2026-04-10', status: 'completed', completedAt: '2026-04-10', anchorDate: '2026-04-10', anchorMonth: '2026-04', reduction: { sufficient: true, changePct: -50, beforeMonths: [{ date: '2026-01' }, { date: '2026-02' }, { date: '2026-03' }, { date: '2026-04' }], afterMonths: [{ date: '2026-05' }], beforeAvg: 1.5, afterAvg: 0 } },
    // 无排期 → 不上图，列表行显示“未设排期，未上图”，reduction 恒 null（生产形态）
    { actionId: 'a5', content: '调研需求', scheduleAt: '', status: 'pending_evaluation', anchorDate: '', anchorMonth: '', reduction: null },
  ],
}

/**
 * 渲染层守卫（2026-11-25 竖线重叠治理）：真渲染 ProblemDetail——
 * 同月多举措一条竖线（竖线传参由 buildMonthlyActionMarkers domain 单测锚定），
 * 这里锚定渲染文案与列表编号徽标：图例说明、无排期披露、“未上图”行、月序号徽标分布。
 */
describe('ProblemDetail 竖线聚合渲染形态', () => {
  const html = renderToStaticMarkup(React.createElement(ProblemDetail, { row: ROW }))

  it('图例文案标注“实施月+角标+状态色”，且披露无排期条数', () => {
    expect(html).toContain('竖线=举措实施月（角标=当月举措数：已完成绿 / 混合橙 / 未完成灰 / 含逾期红）')
    expect(html).toContain('另有 1 条无排期举措未上图')
  })

  it('无排期行显示“未设排期，未上图”，不再出现旧文案“无法对比”', () => {
    expect(html).toContain('未设排期，未上图')
    expect(html).not.toContain('未设排期，无法对比')
  })

  it('列表披露 4 条有排期 + 徽标月份说明（11-26 方案一：月份徽标替代序号）', () => {
    expect(html).toContain('4 条有排期按实施升序')
    expect(html).toContain('徽标月份对应图上竖线')
  })

  it('月份徽标按月分布：2026-03 三条“3月”，2026-04 一条“4月”，无排期无徽标（11-26 方案一）', () => {
    // 徽标形态从序号改为月份（aria-label 保留竖线序号信息供 hover/读屏）
    expect((html.match(/data-badge-month="2026-03"/g) || []).length).toBe(3)
    expect((html.match(/data-badge-month="2026-04"/g) || []).length).toBe(1)
    expect(html).toContain('>3月</span>')
    expect(html).toContain('>4月</span>')
    // 旧序号徽标回潮即红：aria-label 不再是“第 N 个实施月”裸文案（月份徽标 aria 改为含月份与竖线序号）
    expect(html).not.toContain('aria-label="第 1 个实施月"')
  })

  it('有排期但数据不足显示“数据不足”，与无排期的“未设排期，未上图”区分', () => {
    expect(html).toContain('数据不足')
    expect((html.match(/未设排期，未上图/g) || []).length).toBe(1) // 仅无排期行
  })

  it('竖线传参形态：同月 3+1 条有排期举措 → 恰好 2 条竖线，badge 3/1，x 取月内最早日', () => {
    const m = html.match(/data-reference-lines="([^"]*)"/)
    expect(m).toBeTruthy()
    const lines = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    expect(lines.map(({ tooltip, tone, ...rest }) => rest)).toEqual([
      { x: '2026-03-15', badge: 3 },
      { x: '2026-04-10', badge: 1 },
    ])
    // tone 按 fixture：2026-03 = completed+逾期未完成混合 → overdue（红）；2026-04 全完成 → done（绿）
    expect(lines.map((l) => l.tone)).toEqual(['overdue', 'done'])
  })

  it('竖线含 tooltip 传参（当月举措明细，hover 可见——11-25 真机反馈补齐）', () => {
    const m = html.match(/data-reference-lines="([^"]*)"/)
    const lines = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    // 2026-03 竖线 tooltip 应列出该月 3 条举措与实施日
    const march = lines.find((l) => l.x === '2026-03-15')
    expect(march.tooltip).toBeTruthy()
    expect(march.tooltip).toContain('2026-03')
    expect(march.tooltip).toContain('优化连接')
    expect(march.tooltip).toContain('2026-03-20') // 升级内核的排期日
  })

  it('竖线不含文字 label（旧逐条标签回潮即红）', () => {
    const m = html.match(/data-reference-lines="([^"]*)"/)
    const lines = JSON.parse(m[1].replace(/&quot;/g, '"').replace(/&amp;/g, '&'))
    expect(lines.every((l) => l.label === undefined)).toBe(true)
  })
})
