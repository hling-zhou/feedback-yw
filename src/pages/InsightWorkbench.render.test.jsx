import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import InsightWorkbench from './InsightWorkbench.jsx'

/**
 * 工作台真渲染冒烟（2026-11-01 tsc 立项揪出的 DATA_SOURCE_TYPES 未导入 bug 教训：
 * URL 带 ?tab= 参数挂载即 ReferenceError，无参数时短路掩盖）。
 * 红绿：修复前「带 tab 参数」用例抛 Cannot find name 'DATA_SOURCE_TYPES'。
 *
 * 2026-11-09 Tab 记忆：补「无参数 + 有记忆 → 回到上次 Tab」「带参数 + 有记忆 → 参数胜出」
 * 两个用例；断言 data-workbench-tab 属性锚定真实渲染产物。
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
    feedbacksLoading: false,
    periodsLoading: false,
    snapshotsLoading: false,
    currentPeriod: null,
    selectInsightPeriod: vi.fn(),
    loadPostUseRatingForPeriod: vi.fn(),
    postUseCacheGeneration: 0,
    sourceSnapshots: {
      complaint_ticket: null,
      consultation_ticket: null,
      post_use_rating: null,
      user_survey: null,
      other: null,
      reminder: null,
    },
    // 2026-11-09 Tab 记忆用例：最小非空概览快照，让 tab 区域（data-workbench-tab）真实渲染
    overviewSnapshot: {
      status: 'ready',
      summary: { recordCount: 0 },
      crossSourceMetrics: { totalRecords: 0 },
      conclusions: [],
    },
    snapshotsStale: false,
    snapshotStaleReason: '',
    snapshotRebuilding: false,
    rebuildAllSnapshots: vi.fn(),
    importSession: { active: false },
    retagSession: { active: false },
    orderVolumes: [],
    wanTouTargets: [],
    adapter: {},
    sharedBackgroundTasks: [],
    settings: {},
    updateFeedback: vi.fn(),
    markSnapshotsStale: vi.fn(),
    periods: [],
  }),
  useFeedbacks: () => ({ feedbacks: [], settings: {}, adapter: {} }),
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

function renderWorkbench(entry) {
  return renderToStaticMarkup(
    <MemoryRouter initialEntries={[entry]}>
      <InsightWorkbench />
    </MemoryRouter>,
  )
}

/** node 环境无 localStorage：最小内存 stub（Tab 记忆依赖） */
function installMemoryStorage(initial = {}) {
  const store = new Map(Object.entries(initial))
  vi.stubGlobal('localStorage', {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => void store.set(String(key), String(value)),
    removeItem: (key) => void store.delete(String(key)),
  })
}

describe('InsightWorkbench 真渲染冒烟', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('默认（无 tab 参数）挂载不抛错', () => {
    const html = renderWorkbench('/')
    expect(html).toBeTruthy()
    expect(html.length).toBeGreaterThan(100)
  })

  it('URL 带 ?tab=complaint_ticket 挂载不抛错（DATA_SOURCE_TYPES 回归路径）', () => {
    const html = renderWorkbench('/?tab=complaint_ticket')
    expect(html).toBeTruthy()
    expect(html.length).toBeGreaterThan(100)
  })
})

describe('InsightWorkbench Tab 记忆（2026-11-09）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('无参数 + 有上次记忆 → 回到上次离开的 Tab', () => {
    installMemoryStorage({ 'fi.workbench.lastActiveTab.v1': 'post_use_rating' })
    const html = renderWorkbench('/')
    expect(html).toContain('data-workbench-tab="post_use_rating"')
  })

  it('带显式参数 + 有上次记忆 → 参数胜出', () => {
    installMemoryStorage({ 'fi.workbench.lastActiveTab.v1': 'post_use_rating' })
    const html = renderWorkbench('/?tab=complaint_ticket')
    expect(html).toContain('data-workbench-tab="complaint_ticket"')
  })

  it('无参数 + 无记忆 → 第一个 Tab（overview）', () => {
    installMemoryStorage()
    const html = renderWorkbench('/')
    expect(html).toContain('data-workbench-tab="overview"')
  })

  it('记忆值已不在白名单（数据源类型下线残留）→ 回退 overview', () => {
    installMemoryStorage({ 'fi.workbench.lastActiveTab.v1': 'removed_source' })
    const html = renderWorkbench('/')
    expect(html).toContain('data-workbench-tab="overview"')
  })
})
