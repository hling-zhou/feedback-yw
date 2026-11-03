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
    ['generalization', 'generalization', '举一反三'],
    ['playbook', 'playbook', 'Playbook'],
  ]

  it.each(cases)('tab %s 挂载渲染不抛错', (_label, tabParam, marker) => {
    const html = renderActionsTab(tabParam)
    expect(html).toBeTruthy()
    expect(html.length).toBeGreaterThan(100)
    expect(html).toContain(marker)
  })
})

describe('Actions tab 受控解析守卫（2026-11-04 白名单漏 generalization 教训）', () => {
  /**
   * 从静态 HTML 提取 active 的 tab 节点键（结构化断言——与 marker 文案完全解耦）。
   * antd Tabs 的 tab 头节点形态：data-node-key="xxx" class="... ant-tabs-tab-active ..."；
   * marker/label 断言不可用（label 恒渲染且 marker 可能与 label 撞名——G1-3 假绿根因）。
   * @param {string} html
   * @returns {string | null}
   */
  function extractActiveTabKey(html) {
    const m = html.match(/data-node-key="([^"]+)" class="[^"]*ant-tabs-tab-active[^"]*"/)
    return m ? m[1] : null
  }

  it.each([
    ['ticket-todos（默认，无参数）', null, 'ticket-todos'],
    ['product', 'product', 'product'],
    ['problem-reduction', 'problem-reduction', 'problem-reduction'],
    ['observation', 'observation', 'observation'],
    ['generalization', 'generalization', 'generalization'],
    ['playbook', 'playbook', 'playbook'],
    ['未知键回退默认', 'bogus-tab', 'ticket-todos'],
  ])('%s：URL tab 参数解析为 activeKey', (_label, tabParam, expectedKey) => {
    const html = renderActionsTab(tabParam)
    // 白名单漏键的 bug 形态：?tab=X 回退默认 tab → activeKey 为 ticket-todos ≠ X → 此断言红
    expect(extractActiveTabKey(html)).toBe(expectedKey)
  })
})

describe('Actions tab 单源守卫（防 items/白名单散落双写回归）', () => {
  it('源码无多值白名单链（rawTab === x || rawTab === y …——散落双写回潮即红）', async () => {
    const source = await import('node:fs').then((fs) =>
      fs.readFileSync(new URL('./Actions.jsx', import.meta.url), 'utf8'),
    )
    // 单源化后：resolveActionsTabKey 由 ACTIONS_TAB_KEYS 派生（Set 从 items map 来）。
    // （单值特判如旧链接重定向 rawTab === 'post-use-jira' 不属白名单链，放行。）
    expect(source).not.toMatch(/rawTab\s*===\s*'[^']+'\s*\|\|\s*rawTab/)
  })
})
