import React from 'react'
import fs from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

// ── 计数口径链路守卫（11-23 复盘欠账补齐） ──
// 2026-11-23 真机撞破：清单 tab 产品下拉计数曾从 scopedItems（原始评价记录）计数，
// 而清单行是 buildPostUseCallbackLists 内部多道过滤（低分/负面/高频门槛、非 callback
// 通道、10 分排除）后的产出——下拉显示 (n) > tab 实际行数。修复 = 计数从构建产出聚合
//（allLists.recommendations + nonTenRecords）。
// 本守卫双层锚定：
// ① 源码层：计数数据源必须锚在 allLists 产出上（从 scopedItems 计数的回潮即红）；
// ② 渲染层：不 mock 构建函数，喂含"被过滤记录"的真实输入（4 条输入 → 1 个聚合组），
//    SSR 断言"全部产品 (1)"= 产出而非"(4)"= 输入；tab 标签计数与下拉同源。
// 已知 SSR 形态：antd Select 只渲染选中项 label，非选中 options 不进输出——
// 单产品选项计数由源码层断言覆盖（数据源对，产出即对，链条短）。

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'u1', username: 'admin', role: 'admin' }, can: () => true }),
}))

// 4 条输入（同客户同产品同月）：r1(6分)+r2(5分) 低分高频达标 + r3(10分但实质负面) 入选
//（聚合为 1 个客户×产品组——清单聚合语义）；r4(9分无负面) 被过滤不入选但存在于 scopedItems。
// 计数口径差异（产出 1 vs 输入 4）由真实构建函数产出，非 mock。
vi.mock('../context/InsightsContext.jsx', () => {
  const base = (over) => ({
    dataSourceType: 'post_use_rating',
    channel: 'console',
    importMonth: '2026-06',
    product: '弹性公网IP',
    customerName: '中测试客户甲',
    customerCode: 'E00020221031001',
    ...over,
  })
  return {
    useInsights: () => ({
      feedbacks: [
        base({ id: 'r1', ratingScore: 6 }),
        base({ id: 'r2', ratingScore: 5 }),
        base({ id: 'r3', ratingScore: 10, feedbackReasonTexts: ['功能有缺失'] }),
        base({ id: 'r4', ratingScore: 9 }),
      ],
      currentPeriod: {
        id: 'period:month:2026-06',
        label: '2026年6月',
        granularity: 'month',
        anchorYear: 2026,
        anchorMonth: 6,
      },
      settings: { postUseKeyCustomers: [] },
    }),
  }
})

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

const source = fs.readFileSync(new URL('./PostUseCallbackListTab.jsx', import.meta.url), 'utf8')

const html = renderToStaticMarkup(
  React.createElement(PostUseCallbackListTab, {
    onOpenTicket: () => {},
    onNavigateToTrace: () => {},
  }),
)

describe('PostUseCallbackListTab 产品下拉计数口径守卫（计数 = 清单产出，非输入记录）', () => {
  it('源码层：计数数据源锚在构建产出 allLists（从 scopedItems 直接计数的回潮即红）', () => {
    // 全部产品总数 = recommendations + nonTenRecords（构建产出），不从 scopedItems.length 取
    expect(source).toContain('const totalRowCount = allLists.recommendations.length + allLists.nonTenRecords.length')
    // 每产品计数从 allLists.recommendations / allLists.nonTenRecords 聚合
    expect(source).toContain('for (const item of allLists.recommendations)')
    expect(source).toContain('for (const item of allLists.nonTenRecords)')
    // 未选产品时清单直接复用 allLists（同一份产出，杜绝计数与清单两套口径）
    expect(source).toContain(': allLists,')
    // 回潮断言：旧的 scopedItems 计数形态不得回来
    expect(source).not.toContain('全部产品 (${scopedItems.length})')
  })

  it('渲染层：全部产品计数 = 构建产出（1 个聚合组），不是输入记录数（4）', () => {
    // antd SSR：Select 只渲染选中项 label（默认"全部产品"），options 列表客户端打开才渲染
    expect(html).toContain('全部产品 (1)')
    expect(html).not.toContain('全部产品 (4)')
  })

  it('渲染层：tab 标签计数与清单产出联动（1 个聚合组），被过滤的 9 分记录不进计数', () => {
    // r4（9 分无负面）被过滤；r1+r2+r3 聚合 1 组 → 官网问卷类建议回访(1)
    expect(html).toContain('官网问卷类建议回访(1)')
    expect(html).not.toContain('官网问卷类建议回访(4)')
  })
})
