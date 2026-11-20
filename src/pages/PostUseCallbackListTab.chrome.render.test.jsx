import React from 'react'
import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'admin', role: 'admin' }, can: () => true }),
}))

vi.mock('../context/InsightsContext.jsx', () => ({
  useInsights: () => ({
    feedbacks: [],
    currentPeriod: { id: 'period:month:2026-06', label: '2026年6月' },
    settings: { postUseKeyCustomers: [] },
  }),
}))

vi.mock('../lib/productCatalogLoader.js', () => ({
  getCatalogProducts: () => [],
}))

vi.mock('../lib/postUseJiraClient.js', () => ({
  archivePostUseJiraItems: vi.fn(),
  listAssignees: vi.fn(async () => ({ users: [] })),
  listPostUseCallbackDecisions: vi.fn(async () => ({ items: [] })),
  listPostUseJiraItems: vi.fn(async () => ({ items: [] })),
  listPostUseVisitDispatch: vi.fn(async () => ({ items: [] })),
  markPostUseVisitDispatch: vi.fn(),
  upsertPostUseCallbackDecisions: vi.fn(),
}))

vi.mock('../lib/postUseVisitClient.js', () => ({
  batchPreloadPostUseVisits: vi.fn(),
}))

vi.mock('../lib/postUseRating/callbackRecommendationsExport.js', () => ({
  downloadPostUseCallbackRecommendationsExcel: vi.fn(),
}))

import PostUseCallbackListTab from './PostUseCallbackListTab.jsx'

/**
 * 渲染层守卫（T5）：真渲染（renderToStaticMarkup）验证页面形态——
 * 源码扫描够不着的部分在这里锚定（对照 PostUseJiraTab.chrome.render.test.jsx 先例）。
 */
describe('PostUseCallbackListTab 渲染形态', () => {
  const html = renderToStaticMarkup(
    React.createElement(PostUseCallbackListTab, {
      onOpenTicket: () => {},
      onNavigateToTrace: () => {},
    }),
  )

  it('吸顶条为白底卡片内嵌（sticky top-0 + -mx-4 bg-white），无页面级 page-sticky-chrome/灰底', () => {
    expect(html).toContain('sticky top-0')
    expect(html).toContain('-mx-4')
    expect(html).toContain('bg-white')
    expect(html).not.toContain('page-sticky-chrome')
    expect(html).not.toContain('bg-ink-50')
  })

  it('产品下拉存在且默认「全部产品」', () => {
    expect(html).toContain('全部产品 (')
  })

  it('双 Tabs 与操作条按钮齐全', () => {
    expect(html).toContain('官网问卷类建议回访(')
    expect(html).toContain('投诉回访非10分(')
    expect(html).toContain('存档「产品部溯源」')
    expect(html).toContain('发送待省代表回访')
    expect(html).toContain('下载原始清单')
  })

  it('空数据空态文案存在（无假数据）', () => {
    // 激活 tab（questionnaire）的空态在 SSR 输出中
    expect(html).toContain('当前范围内暂无官网问卷类建议回访记录')
    // 非激活 tab antd 懒渲染（弹窗同款行为），空态文案锚源码
    const source = fs.readFileSync(new URL('./PostUseCallbackListTab.jsx', import.meta.url), 'utf8')
    expect(source).toContain('当前范围内暂无投诉回访非10分记录')
  })

  it('快捷筛选 checkbox 带动态计数', () => {
    expect(html).toContain('已纳入产品部回溯（')
    expect(html).toContain('已纳入省代表回访（')
  })
})
