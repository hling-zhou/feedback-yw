import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
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

describe('ApiPatrolFailures 真渲染冒烟', () => {
  it('页面挂载不炸：两表+范围选择器渲染', () => {
    const html = renderToStaticMarkup(React.createElement(ApiPatrolFailures))
    // 独有文案锚定（不与导航撞名）
    expect(html).toContain('异常接口列表')
    expect(html).toContain('失败请求列表')
    expect(html).toContain('组 = 同客户同接口 1 小时内失败链') // 独有说明
    expect(html).toContain('近7天')
    expect(html).toContain('近30天')
  })

  it('筛选器组渲染（RequestID/根因L1/处理状态含未诊断）', () => {
    const html = renderToStaticMarkup(React.createElement(ApiPatrolFailures))
    expect(html).toContain('RequestID')
    expect(html).toContain('根因 L1')
    expect(html).toContain('处理状态')
  })

  it('表格列头渲染（成功率/总次数/失败次数/压缩前失败次数）', () => {
    const html = renderToStaticMarkup(React.createElement(ApiPatrolFailures))
    expect(html).toContain('成功率')
    expect(html).toContain('总次数')
    expect(html).toContain('失败次数')
    expect(html).toContain('压缩前失败次数')      // 11-11 拍板改名（口径=组内失败行数）
    expect(html).not.toContain('压缩前次数')      // 旧列名全页面退场（列表+抽屉）
    expect(html).toContain('产品侧处理状态')
    expect(html).toContain('资源池')               // 失败请求列表新列（配合源码正则锚定，防与异常接口列表撞名恒绿）
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
    const html = renderToStaticMarkup(React.createElement(ApiPatrolFailures))
    expect(html).toContain('巡检概况')
    expect(html).toContain('检测结果总结，随时间范围刷新') // 卡片独有说明文案（防撞名）
    expect(html).toContain('暂无概况') // useEffect 不跑 → 空态占位
    expect(html).not.toContain('LLM 润色') // 无数据时不误显 LLM 状态 Tag
    expect(html).not.toContain('LLM 未启用') // 三态：无数据不显
  })
})
