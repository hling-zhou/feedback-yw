import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

/**
 * API 巡检总览页真渲染冒烟测试（M7）。
 * 断言锚定五模块独有文案/结构（防撞名恒绿）；useEffect 不执行（数据拉取不触发，空态渲染）。
 */

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ can: () => true }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))
vi.mock('../lib/apiClient.js', () => ({
  apiFetch: vi.fn(async () => ({
    byProductCause: [], dailyTrend: [], l2Calendar: [], metricTrends: [],
    aiSummaryFacts: {
      rangeDesc: '2026-09-01 ~ 2026-09-02', totalGroups: 0, pendingGroups: 0,
      simGroups: 0, preCompressTotal: 0, undiagnosedGroups: 0, topCause: '', topApi: '',
    },
    aiSummary: { degraded: true, text: '暂无失败组。' },
  })),
}))

import ApiPatrolOverview from './ApiPatrolOverview.jsx'

function renderOverview() {
  return renderToStaticMarkup(
    React.createElement(MemoryRouter, { initialEntries: ['/api-patrol/overview'] },
      React.createElement(ApiPatrolOverview)),
  )
}

describe('ApiPatrolOverview 真渲染冒烟（五模块）', () => {
  it('①AI 综述卡恒渲染（空态显示加载中，数据到位后统计位/降级标记由 API 数据驱动）', () => {
    const html = renderOverview()
    expect(html).toContain('AI 综述')
    expect(html).toContain('加载中…') // 空态（renderToStaticMarkup 不跑 useEffect）
    expect(html).not.toContain('LLM 未启用') // 无数据时 LLM 状态 Tag 不误显
  })

  it('②根因分布卡（堆叠柱/表格切换 + 跳转说明）', () => {
    const html = renderOverview()
    expect(html).toContain('根因分布（产品 × L1 大类）')
    expect(html).toContain('堆叠柱')
    expect(html).toContain('点击表格行可跳转溯源页') // 独有说明
  })

  it('③指标趋势卡（缺天断线说明+补算开关）', () => {
    const html = renderOverview()
    expect(html).toContain('指标成功率趋势')
    expect(html).toContain('未达推送阈值')   // 缺天断线口径说明
    expect(html).toContain('含明细补算')     // 补算开关
  })

  it('④⑤L1 趋势七类 + 跨日轨迹双形态', () => {
    const html = renderOverview()
    expect(html).toContain('根因大类趋势（L1 七类全画）')
    expect(html).toContain('跨日轨迹（L2 Top8）')
    expect(html).toContain('热力')
    expect(html).toContain('折线')
  })
})
