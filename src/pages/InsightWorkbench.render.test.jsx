import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import InsightWorkbench from './InsightWorkbench.jsx'

/**
 * 工作台真渲染冒烟（2026-11-01 tsc 立项揪出的 DATA_SOURCE_TYPES 未导入 bug 教训：
 * URL 带 ?tab= 参数挂载即 ReferenceError，无参数时短路掩盖）。
 * 红绿：修复前「带 tab 参数」用例抛 Cannot find name 'DATA_SOURCE_TYPES'。
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
    overviewSnapshot: null,
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

describe('InsightWorkbench 真渲染冒烟', () => {
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
