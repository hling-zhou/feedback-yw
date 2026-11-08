import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({ can: () => true }),
}))

vi.mock('../lib/postUseJiraClient.js', () => ({
  deletePostUseJiraItem: vi.fn(),
  deletePostUseJiraItems: vi.fn(),
  listAssignees: vi.fn(async () => []),
  listPostUseJiraItems: vi.fn(async () => ({ items: [] })),
  patchPostUseJiraItem: vi.fn(),
}))

import PostUseJiraTab from './PostUseJiraTab.jsx'

/**
 * 布局一致性守卫（11-09 方案 A 用户拍板）：
 * 溯源视图工具条必须是「卡片内嵌吸顶形态」——白底 + -mx-4/px-4（抵消宿主
 * page-card 的 p-4），与工单/原始数据视图的共享 sticky chrome 同款；
 * 禁止回潮页面级 .page-sticky-chrome（负边距锚定外壳 padding，嵌卡片内
 * lg 断点溢出卡片边缘、灰底与白底卡片视觉割裂）。
 */
describe('PostUseJiraTab 工具条卡片内嵌形态', () => {
  it('吸顶条为白底卡片内嵌（sticky top-0 + -mx-4 px-4 bg-white），非页面级 page-sticky-chrome', async () => {
    const html = renderToStaticMarkup(<PostUseJiraTab months={['2026-07']} periodLabel="2026年7月" />)
    // 白底内嵌吸顶条存在
    expect(html).toContain('sticky top-0')
    expect(html).toContain('-mx-4')
    expect(html).toContain('bg-white')
    // 页面级 sticky 类不得出现（回潮即红）
    expect(html).not.toContain('page-sticky-chrome')
    // 灰底不得用于工具条背景
    expect(html).not.toContain('bg-ink-50')
  })
})
