import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import Actions from './Actions.jsx'

/**
 * Actions 页真渲染冒烟测试（2026-11-01 ProductActionsTab searchParams ReferenceError 教训）。
 *
 * 与源码文本匹配（wiring/layout 测试）的本质区别：这里真的把每个 tab 的组件树
 * 渲染一遍（renderToStaticMarkup），渲染路径上的 ReferenceError / TypeError 会直接让
 * 测试失败——文本匹配永远测不到"挂载即炸"。
 *
 * 设计：antd Tabs 的非激活 pane 首次激活前不渲染，因此按 URL tab 参数逐个渲染整个
 * Actions 页，等价于"用户点击每个 tab"的真实场景（lazy mount 语义一致）。
 *
 * renderToStaticMarkup 不执行 useEffect，因此数据拉取类 effect 天然不触发，
 * 只需 mock 渲染路径上真正会被调用的 hooks（context / 自定义 hook）。
 */

vi.mock('../context/AuthContext.jsx', () => ({
  useAuth: () => ({
    user: { id: 'u1', username: 'render-tester', role: 'admin', team: '综合管理组' },
    can: () => true,
    logout: vi.fn(),
  }),
  AuthProvider: ({ children }) => children,
}))

vi.mock('../context/InsightsContext.jsx', () => ({
  useInsights: () => ({
    feedbacks: [],
    updateFeedback: vi.fn(),
    retagSession: vi.fn(),
    importSession: vi.fn(),
    sharedBackgroundTasks: [],
    reprocessing: false,
    settings: {},
    adapter: {},
    markSnapshotsStale: vi.fn(),
    currentPeriod: null,
    periodsLoading: false,
    selectInsightPeriod: vi.fn(),
    periods: [],
  }),
  useFeedbacks: () => ({
    feedbacks: [],
    settings: {},
    adapter: {},
  }),
  InsightsProvider: ({ children }) => children,
}))

vi.mock('../context/UserTicketReviewContext.jsx', () => ({
  useUserTicketReviews: () => ({
    enabled: false,
    isReviewDone: vi.fn(),
    markReviewDone: vi.fn(),
    clearReview: vi.fn(),
  }),
  UserTicketReviewProvider: ({ children }) => children,
}))

vi.mock('../hooks/useAppMessage.js', () => ({
  useAppMessage: () => ({
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  }),
}))

/** 按指定 tab 参数渲染整个 Actions 页；返回静态 HTML。渲染路径抛错时该函数直接失败。 */
function renderActionsTab(tabParam) {
  const entry = tabParam ? `/?tab=${tabParam}` : '/'
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[entry]}>
      <Actions />
    </MemoryRouter>,
  )
}

describe('Actions 页各 tab 真渲染冒烟', () => {
  const cases = [
    ['ticket-todos（默认）', null, '会议待办'],
    ['product', 'product', '产品举措与进展'],
    ['problem-reduction', 'problem-reduction', '问题压降'],
    ['observation', 'observation', '留观问题'],
    ['playbook', 'playbook', 'Playbook'],
  ]

  it.each(cases)('tab %s 挂载渲染不抛错', (_label, tabParam, marker) => {
    const html = renderActionsTab(tabParam)
    expect(html).toBeTruthy()
    expect(html.length).toBeGreaterThan(100)
    expect(html).toContain(marker)
  })
})
