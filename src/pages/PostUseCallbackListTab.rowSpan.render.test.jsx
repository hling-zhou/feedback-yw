import React from 'react'
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

// 官网问卷类建议回访清单按客户聚合，客户名称/客户编码/触发类型三列客户级合并（rowSpan）。
// 2026-11-23 真机撞破：分组循环步进手抄偏差（i = j 误写 i += 1）导致组内非首行被
// 重标成组首（span 递减），rowSpan:0 吞行失效、行多出 3 个 td、整行列错位。
// 本守卫锚定链路层（真实 antd Table + 真实分组逻辑 SSR 输出），红绿已自证。
vi.mock('../lib/postUseRating/callbackListModel.js', async () => {
  const actual = await vi.importActual('../lib/postUseRating/callbackListModel.js')
  const base = (name, code, key) => ({
    customerName: name,
    customerCode: code,
    isKeyCustomer: false,
    importMonths: ['2026-06'],
    triggerType: '高频低分客户',
    lowScoreLt7Count: 1,
    scoreBreakdown: `${key}*1分*1次`,
    latestFeedbackAt: '2026-06-20',
    channels: ['控制台'],
    feedbackReasonSummary: '界面卡顿',
    recommendedReason: '建议回访确认',
    sourceType: 'post_use_rating',
  })
  return {
    ...actual,
    buildPostUseCallbackLists: () => ({
      recommendations: [
        // 甲客户 2 行 → 合并组 rowSpan=2（最小复现形态）
        { ...base('中测试客户甲', 'E00020221031001', '产品A'), itemKey: 'post_use_rating::中测试客户甲::产品A::2026-06', productName: '产品A' },
        { ...base('中测试客户甲', 'E00020221031001', '产品B'), itemKey: 'post_use_rating::中测试客户甲::产品B::2026-06', productName: '产品B' },
        // 乙客户 3 行 → 合并组 rowSpan=3（覆盖 span 递减型回归：旧行为下三行全被标成组首）
        { ...base('中测试客户乙', 'E00020221031002', '产品C'), itemKey: 'post_use_rating::中测试客户乙::产品C::2026-06', productName: '产品C' },
        { ...base('中测试客户乙', 'E00020221031002', '产品D'), itemKey: 'post_use_rating::中测试客户乙::产品D::2026-06', productName: '产品D' },
        { ...base('中测试客户乙', 'E00020221031002', '产品E'), itemKey: 'post_use_rating::中测试客户乙::产品E::2026-06', productName: '产品E' },
      ],
      nonTenRecords: [],
    }),
  }
})

import PostUseCallbackListTab from './PostUseCallbackListTab.jsx'

/**
 * 提取 tbody 中数据行（跳过 antd 测量行——其 td 无 class）。
 * cells = 每个 <td> 开标签（含 rowspan/class，供结构断言）；
 * content = tr 内全文（含单元格文本与 title 属性，供内容断言；tr 开标签含 data-row-key 不进捕获组）。
 */
function extractDataRows(html) {
  const tbody = html.slice(html.indexOf('<tbody'), html.indexOf('</tbody>'))
  const rows = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRegex.exec(tbody))) {
    const cells = []
    const tdRegex = /<td[^>]*>/g
    let c
    while ((c = tdRegex.exec(m[1]))) cells.push(c[0])
    if (cells.length && cells[0].includes('ant-table-cell')) {
      rows.push({ cells, content: m[1] })
    }
  }
  return rows
}

const html = renderToStaticMarkup(
  React.createElement(PostUseCallbackListTab, {
    onOpenTicket: () => {},
    onNavigateToTrace: () => {},
  }),
)
const rows = extractDataRows(html)

describe('PostUseCallbackListTab 客户级合并单元格（rowSpan）链路守卫', () => {
  it('SSR 输出包含全部 5 条数据行（2+3 两个合并组）', () => {
    expect(rows.length).toBe(5)
  })

  it('组首行 3 个合并列携带 rowSpan（2 行组=2 / 3 行组=3），其余列不携带', () => {
    // 甲组首行（第 1 数据行）：客户名称/客户编码/触发类型 rowspan="2"
    const span2 = rows[0].cells.filter((c) => c.includes('rowspan="2"'))
    expect(span2.length).toBe(3)
    // 乙组首行（第 3 数据行）：三列 rowspan="3"
    const span3 = rows[2].cells.filter((c) => c.includes('rowspan="3"'))
    expect(span3.length).toBe(3)
  })

  it('非组首行的合并列被 rowSpan:0 正确吞掉：td 数 = 组首行 − 3，且无残留 rowspan 属性', () => {
    const firstRowCount = rows[0].cells.length
    for (const index of [1, 3, 4]) {
      expect(rows[index].cells.length).toBe(firstRowCount - 3)
      expect(rows[index].cells.some((c) => c.includes('rowspan='))).toBe(false)
    }
  })

  it('非组首行不再重复渲染客户名/编码（旧 bug：被重标成组首后整行多出 3 个错位格）', () => {
    const row2OfA = rows[1].content
    expect(row2OfA).not.toContain('中测试客户甲')
    expect(row2OfA).not.toContain('E00020221031001')
    expect(rows[0].content).toContain('中测试客户甲')
    expect(rows[0].content).toContain('E00020221031001')
    expect(rows[3].content).not.toContain('中测试客户乙')
    expect(rows[4].content).not.toContain('中测试客户乙')
    expect(rows[2].content).toContain('中测试客户乙')
  })

  it('产品列行级独立：每个数据行都渲染自己的产品名', () => {
    for (const product of ['产品A', '产品B', '产品C', '产品D', '产品E']) {
      expect(html).toContain(product)
    }
  })
})
