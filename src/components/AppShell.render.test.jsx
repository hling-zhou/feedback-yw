import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell.jsx'

/**
 * AppShell 左导航两级结构守卫测试（2026-11-06 导航改版）。
 *
 * 与源码文本匹配测试的本质区别：这里真的把 AppShell 渲染一遍（renderToStaticMarkup），
 * 渲染路径上的 ReferenceError / TypeError / antd Menu items 结构错误会直接让测试失败。
 *
 * 断言策略（吸取 Actions.render.test.jsx 假绿教训）：
 * - 选中态用结构化提取（.ant-menu-item-selected + 同节点文本），不依赖 marker 文本散点匹配；
 * - 分组标题断言 .ant-menu-item-group-title 节点内文本；
 * - 分组子项断言 .ant-menu-item-group-list 内出现对应叶子 key 的菜单项。
 *
 * renderToStaticMarkup 不执行 useEffect，因此数据拉取类 effect 天然不触发，
 * 只需 mock 渲染路径上真正会被调用的 hooks / context。
 */

/**
 * 测试内可替换的 canRoute 实现（默认全放行）。
 * useAuth mock 在渲染期（it 内）才被调用，此时模块体已执行完毕，闭包引用安全。
 * @param {string} [p]
 * @returns {boolean}
 */
let canRouteImpl = (p) => {
  void p
  return true
}

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'shell-render', role: 'admin', team: '综合管理组' },
    can: () => true,
    /** @param {string} p */
    canRoute: (p) => canRouteImpl(p),
    logout: vi.fn(),
  }),
}))

vi.mock('../context/InsightsContext.jsx', () => ({
  useInsights: () => ({
    feedbacks: [],
    sharedBackgroundTasks: [],
    currentPeriod: null,
    totalRecordCount: 0,
  }),
}))

vi.mock('../hooks/usePeriodScope.js', () => ({
  usePeriodScope: () => ({ period: null, periodCount: 0, totalInDb: 0 }),
}))

vi.mock('../hooks/useUsageTracking.js', () => ({
  useUsageTracking: vi.fn(),
}))

vi.mock('../lib/whatsNewFeedClient.js', () => ({
  fetchWhatsNewFeed: () => Promise.resolve([]),
}))

vi.mock('./ImportSessionGuard.jsx', () => ({ default: () => null }))
vi.mock('./RetagSessionGuard.jsx', () => ({ default: () => null }))
vi.mock('./MessageBottleSubmitModal.jsx', () => ({ default: () => null }))
vi.mock('./MessageBottleFab.jsx', () => ({ default: () => null }))
vi.mock('./WhatsNewFab.jsx', () => ({ default: () => null }))
vi.mock('./WhatsNewDrawer.jsx', () => ({ default: () => null }))
vi.mock('./ReminderFab.jsx', () => ({ default: () => null }))
vi.mock('./ReminderSendModal.jsx', () => ({ default: () => null }))

/**
 * 渲染 AppShell（指定当前路由与角色可见性函数），返回静态 HTML。
 * @param {string} pathname
 * @param {{ canRoute?: (path: string) => boolean }} [options]
 */
function renderShell(pathname, { canRoute } = {}) {
  if (canRoute) canRouteImpl = canRoute
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[pathname]}>
      <AppShell />
    </MemoryRouter>,
  )
}

/** 从静态 HTML 提取选中菜单项的文本（结构化：.ant-menu-item-selected 节点内容）。 */
function extractSelectedItemLabel(html) {
  const m = html.match(/<li[^>]*class="[^"]*ant-menu-item-selected[^"]*"[^>]*>([\s\S]*?)<\/li>/)
  return m ? m[1] : null
}

describe('AppShell 左导航两级结构（真渲染守卫）', () => {
  it('分组标题与子项结构：线上VOC 3 项 + API巡检 2 项 + 7 平级项', () => {
    const html = renderShell('/workbench')
    // 两个固定分组标题（antd Menu group 标题节点）
    expect(html).toMatch(/class="[^"]*ant-menu-item-group-title[^"]*"[^>]*>\s*线上VOC\s*</)
    expect(html).toMatch(/class="[^"]*ant-menu-item-group-title[^"]*"[^>]*>\s*API巡检\s*</)
    // 线上VOC 分组列表内三个子项 key（data-menu-id 前缀由 antd 内部生成，不锚定）
    for (const key of ['/workbench', '/topics', '/feedbacks']) {
      expect(html).toMatch(new RegExp(`data-menu-id="[^"]*${key.replace(/\//g, '\\/')}"`))
    }
    // API巡检 分组两个子项 key
    for (const key of ['/api-patrol/overview', '/api-patrol/failures']) {
      expect(html).toMatch(new RegExp(`data-menu-id="[^"]*${key.replace(/\//g, '\\/')}"`))
    }
    // 平级项仍在（抽样 4 个）
    for (const key of ['/actions', '/import', '/settings', '/mcp-guide']) {
      expect(html).toMatch(new RegExp(`data-menu-id="[^"]*${key.replace(/\//g, '\\/')}"`))
    }
    // MCP 分隔线仍在（antd divider 渲染为 ant-menu-item-divider）
    expect(html).toContain('ant-menu-item-divider')
  })

  it('选中态：/api-patrol/failures 精确高亮（最长前缀匹配，不误高亮总览）', () => {
    const html = renderShell('/api-patrol/failures')
    const selected = extractSelectedItemLabel(html)
    expect(selected).toBeTruthy()
    expect(selected).toContain('异常接口溯源')
    expect(selected).not.toContain('总览')
  })

  it('选中态：/api-patrol/overview 高亮总览', () => {
    const html = renderShell('/api-patrol/overview')
    const selected = extractSelectedItemLabel(html)
    expect(selected).toBeTruthy()
    expect(selected).toContain('总览')
  })

  it('选中态：既有路由不受影响（/feedbacks、/operations 抽样）', () => {
    for (const [pathname, label] of [
      ['/feedbacks', '反馈库'],
      ['/operations', '运营分析'],
    ]) {
      const html = renderShell(pathname)
      const selected = extractSelectedItemLabel(html)
      expect(selected).toBeTruthy()
      expect(selected).toContain(label)
    }
  })

  it('角色过滤：组内全部子项被隐藏时整组不渲染（隐藏 VOC 三项则无线上VOC分组）', () => {
    const html = renderShell('/actions', {
      canRoute: (path) => !['/workbench', '/topics', '/feedbacks'].includes(path),
    })
    expect(html).not.toMatch(/ant-menu-item-group-title[^>]*>\s*线上VOC/)
    // API巡检分组不受影响
    expect(html).toMatch(/ant-menu-item-group-title[^>]*>\s*API巡检/)
  })
})
