import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

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

  it('表格列头渲染（成功率/总次数/失败次数/压缩前次数）', () => {
    const html = renderToStaticMarkup(React.createElement(ApiPatrolFailures))
    expect(html).toContain('成功率')
    expect(html).toContain('总次数')
    expect(html).toContain('失败次数')
    expect(html).toContain('压缩前次数')
    expect(html).toContain('产品侧处理状态')
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
