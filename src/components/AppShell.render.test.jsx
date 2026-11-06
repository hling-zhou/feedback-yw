import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import AppShell from './AppShell.jsx'

/**
 * AppShell 左导航结构守卫测试（2026-11-06 导航改版 / 2026-11-07 层级误读修复）。
 *
 * 与源码文本匹配测试的本质区别：这里真的把 AppShell 渲染一遍（renderToStaticMarkup），
 * 渲染路径上的 ReferenceError / TypeError / antd Menu items 结构错误会直接让测试失败。
 *
 * 断言策略（吸取 Actions.render.test.jsx 假绿教训）：
 * - 选中态用结构化提取（.ant-menu-item-selected + 同节点文本），不依赖 marker 文本散点匹配；
 * - 分组标题断言 .ant-menu-item-group-title 节点内文本；
 * - 分组子项断言 .ant-menu-item-group-list 内出现对应叶子 key 的菜单项；
 * - 分组闭合线：API巡检 组后必须有 divider，切断「问题与举措」的从属误读；
 * - 孤线清理：角色过滤把 divider 相邻项整段隐藏后，不得残留无意义 divider。
 *
 * renderToStaticMarkup 不执行 useEffect，因此数据拉取类 effect 天然不触发，
 * 只需 mock 渲染路径上真正会被调用的 hooks / context。
 */

/**
 * 测试内可替换的 canRoute / usePeriodScope 实现（默认全放行 + 无周期）。
 * useAuth mock 在渲染期（it 内）才被调用，此时模块体已执行完毕，闭包引用安全。
 * @param {string} [p]
 * @returns {boolean}
 */
let canRouteImpl = (p) => {
  void p
  return true
}

/** @type {() => { period: unknown, periodCount: number, totalInDb: number }} */
let periodScopeImpl = () => ({ period: null, periodCount: 0, totalInDb: 0 })

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
  usePeriodScope: () => periodScopeImpl(),
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
 * 渲染 AppShell（指定当前路由 / 角色可见性 / 周期数据），返回静态 HTML。
 * 纪律：两个 impl 每次调用都显式重置——不传则回落默认值。
 * 早期版本只在传参时赋值，导致前面的用例把限制性 canRoute 泄漏给后面
 * 未传参的用例（选中态抽样假失败），测试间状态必须零泄漏。
 * @param {string} pathname
 * @param {{ canRoute?: (path: string) => boolean, periodScope?: () => { period: unknown, periodCount: number, totalInDb: number } }} [options]
 */
function renderShell(pathname, { canRoute, periodScope } = {}) {
  canRouteImpl = canRoute ?? ((p) => (void p, true))
  periodScopeImpl =
    periodScope ?? (() => ({ period: null, periodCount: 0, totalInDb: 0 }))
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

/** 统计菜单内 divider 数量（antd 渲染为 ant-menu-item-divider）。 */
function countDividers(html) {
  return (html.match(/ant-menu-item-divider/g) || []).length
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
  })

  it('分组闭合线：API巡检 与 问题与举措 之间必须有 divider（层级误读修复的核心断言）', () => {
    const html = renderShell('/workbench')
    expect(countDividers(html)).toBe(2)
    // 顺序断言：异常接口溯源（API巡检组尾）→ divider → 问题与举措（首个平级项）
    const patrolEnd = html.indexOf('异常接口溯源')
    const actionsStart = html.indexOf('问题与举措')
    expect(patrolEnd).toBeGreaterThan(-1)
    expect(actionsStart).toBeGreaterThan(-1)
    const between = html.slice(patrolEnd, actionsStart)
    expect(between).toContain('ant-menu-item-divider')
    // MCP 前的 divider 也在
    const mcpStart = html.indexOf('MCP 数据服务')
    expect(mcpStart).toBeGreaterThan(-1)
    expect(html.slice(actionsStart, mcpStart)).toContain('ant-menu-item-divider')
  })

  it('孤线清理：全部平级项隐藏时组后闭合线必须被清掉，不得残留尾随 divider', () => {
    const html = renderShell('/workbench', {
      canRoute: (path) => ['/workbench', '/topics', '/feedbacks'].includes(path),
    })
    // VOC 组保留，但其后的两条 divider 因后续节点全部隐藏而必须被 prune
    expect(html).toMatch(/ant-menu-item-group-title[^>]*>\s*线上VOC/)
    expect(countDividers(html)).toBe(0)
  })

  it('孤线清理：仅剩 MCP 项时开头 divider 必须被清掉（不渲染无前项的 divider）', () => {
    const html = renderShell('/mcp-guide', {
      canRoute: (path) => path === '/mcp-guide',
    })
    expect(html).toMatch(new RegExp(`data-menu-id="[^"]*${'/mcp-guide'.replace(/\//g, '\\/')}"`))
    expect(countDividers(html)).toBe(0)
  })

  it('孤线清理：中段平级项全隐藏但 MCP 可见时，MCP 前 divider 正常保留', () => {
    const html = renderShell('/mcp-guide', {
      canRoute: (path) =>
        ['/workbench', '/topics', '/feedbacks', '/api-patrol/overview', '/api-patrol/failures', '/mcp-guide'].includes(path),
    })
    // 组后闭合线因 MCP 仍存在而不属于孤线；MCP 前 divider 同理保留
    expect(countDividers(html)).toBe(1)
    const afterMcp = html.slice(html.indexOf('MCP 数据服务'))
    expect(afterMcp).not.toContain('ant-menu-item-divider')
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
    // API巡检分组不受影响；其组后闭合线因 /actions 可见而保留
    expect(html).toMatch(/ant-menu-item-group-title[^>]*>\s*API巡检/)
    expect(countDividers(html)).toBeGreaterThanOrEqual(1)
  })
})

describe('AppShell 底部用户区（紧凑化 + 账号操作 Dropdown）', () => {
  it('账号操作收纳进 Dropdown：触发器存在，展开态不再渲染常驻 修改密码/退出登录 按钮', () => {
    const html = renderShell('/workbench')
    expect(html).toContain('aria-label="账号操作"')
    // Dropdown popup 懒渲染，初始 HTML 不应有菜单项文本，也不再有常驻 link 按钮
    expect(html).not.toContain('>修改密码<')
    expect(html).not.toContain('>退出登录<')
  })

  it('无周期时展示库内反馈行内计数（Statistic 已移除）', () => {
    const html = renderShell('/workbench')
    expect(html).toContain('库内反馈')
    expect(html).not.toContain('ant-statistic')
  })

  it('有周期时展示周期标签 + 周期内计数 + 库内合计', () => {
    const html = renderShell('/workbench', {
      periodScope: () => ({
        period: { id: 'p1', label: '2026-10 月度' },
        periodCount: 42,
        totalInDb: 100,
      }),
    })
    expect(html).toContain('洞察周期 · 2026-10 月度')
    expect(html).toContain('周期内反馈')
    expect(html).toContain('42')
    expect(html).toContain('库内合计 100')
    expect(html).not.toContain('ant-statistic')
  })
})
