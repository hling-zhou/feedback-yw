import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { StaticRouter } from 'react-router'
import { describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * API 巡检溯源页真渲染冒烟测试（M6）。
 * renderToStaticMarkup 真渲染——挂载即炸直接红；useEffect 不执行（数据拉取不触发）。
 * 断言锚定页面独有文案（防与导航/Tab label 撞名恒绿——11-04 教训）。
 */

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ can: () => true }),
  AuthProvider: ({ children }) => children,
}))
vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }),
}))
// dayjs 在 SSR 静态渲染下可用（无 DOM 依赖）；apiFetch mock 返回空数据
vi.mock('../lib/apiClient.js', () => ({
  apiFetch: vi.fn(async () => ({ rows: [], group: null, diagnosis: null, requests: [] })),
}))

import ApiPatrolFailures from './ApiPatrolFailures.jsx'

const renderPage = (search = '') => renderToStaticMarkup(
  <StaticRouter location={`/api-patrol/failures${search}`}>
    <ApiPatrolFailures />
  </StaticRouter>,
)

describe('ApiPatrolFailures 真渲染冒烟', () => {
  it('默认展示异常接口 Tab，两个 Tab 共用时间范围', () => {
    const html = renderPage()
    expect(html).toContain('异常接口列表')
    expect(html).toContain('失败请求列表')
    expect(html).toContain('跨日视图：成功率/次数按明细')
    expect(html).not.toContain('组 = 同客户同接口 1 小时内失败链')
    expect(html).toContain('近7天')
    expect(html).toContain('近30天')
  })

  it('根因分布跳转展示失败请求 Tab 和快捷筛选', () => {
    const html = renderPage('?rootCauseL1=业务冲突')
    expect(html).toContain('组 = 同客户同接口 1 小时内失败链')
    expect(html).toContain('需产品侧处理')
    expect(html).toContain('RequestID')
    expect(html).toContain('处理状态')
    expect(html).toContain('业务冲突')
  })

  it('两个 Tab 分别渲染对应的表格列', () => {
    const interfaces = renderPage()
    expect(interfaces).toContain('成功率')
    expect(interfaces).toContain('总次数')
    expect(interfaces).toContain('失败次数')
    const groups = renderPage('?rootCauseL1=业务冲突')
    expect(groups).toContain('压缩前失败次数')
    expect(groups).not.toContain('压缩前次数')
    expect(groups).toContain('产品侧处理状态')
    expect(groups).toContain('资源池')
  })

  it('失败请求列表列契约（源码正则）：资源池列在前两列固定+压缩前失败次数（11-11 拍板）', () => {
    const contentPath = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'components', 'apiPatrol', 'ApiPatrolFailuresContent.jsx')
    const src = fs.readFileSync(contentPath, 'utf-8')
    // 失败请求列表资源池列定义（title+dataIndex 组合形态；抽屉 Descriptions 的 pool 是 label/children 形态不会误匹配）
    expect(src).toMatch(/title: '资源池', dataIndex: 'poolName'/)
    // 旧列名退场（列表 title + 抽屉 label 都不再出现）
    expect(src).not.toMatch(/'压缩前次数'/)
    // 前两列固定（RequestID + 指标名称）
    const fixedCount = (src.match(/fixed: 'left'/g) || []).length
    expect(fixedCount).toBeGreaterThanOrEqual(2)
    // 失败请求列表 Table 启用横向滚动（antd 固定列前提）
    expect(src).toMatch(/scroll=\{\{ x: \d+ \}\}/)
    // 异常接口列表分页总数（11-11：对齐 ec3b5e3 全局形态；条件分页旧形态退场）
    expect(src).not.toMatch(/interfaces\.length > 20 \? \{ pageSize: 20 \} : false/)
    const showTotalCount = (src.match(/showTotal: paginationShowTotal/g) || []).length
    expect(showTotalCount).toBeGreaterThanOrEqual(2)   // 异常接口列表 + 失败请求列表两表都有
  })

  it('巡检概况卡渲染（2026-11-07 拍板：页面顶部检测结果总结；空数据占位不误显 LLM 状态）', () => {
    const html = renderPage()
    expect(html).toContain('巡检概况')
    expect(html).toContain('检测结果总结，随时间范围刷新') // 卡片独有说明文案（防撞名）
    expect(html).toContain('暂无概况') // useEffect 不跑 → 空态占位
    expect(html).not.toContain('LLM 润色') // 无数据时不误显 LLM 状态 Tag
    expect(html).not.toContain('LLM 未启用') // 三态：无数据不显
  })
})
