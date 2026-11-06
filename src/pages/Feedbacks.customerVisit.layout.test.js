import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Feedbacks customer visit tab', () => {
  const source = fs.readFileSync(new URL('./Feedbacks.jsx', import.meta.url), 'utf8')

  it('includes a read-only customer visit tab with composite search and export', () => {
    expect(source).toContain('FEEDBACK_LANE_CUSTOMER_VISITS')
    expect(source).toContain('客服部回访')
    expect(source).toContain('feedback-lane-tabs')
    expect(source).toContain("{ key: FEEDBACK_LANE_TICKETS, label: '投诉咨询工单' }")
    expect(source).toContain('FEEDBACK_CUSTOMER_VISIT_COMPOSITE_KEYS')
    expect(source).toContain('visitCustomerNameOptions')
    expect(source).toContain('buildPostUseCustomerVisitRows')
  })

  it('renders customer visit table with evaluation state and drawer selection', () => {
    expect(source).toContain('function CustomerVisitTable')
    expect(source).toContain('__evaluationState')
    expect(source).toContain('PostUseVisitDrawer')
    // 2026-11-05 个人标记体系下线守卫（红绿证明过：visit: 前缀回潮即红）
    expect(source).not.toContain('postUseVisitReviewId')
    expect(source).not.toContain('__myStatus')
    // 回访分支的筛选器不再挂我的处理状态（工单主列表的 FeedbackFilterBar 合法保留，故不做全局 not 断言）
    const visitBranch = source.split('isCustomerVisitLane ?')[1] || ''
    expect(visitBranch).not.toContain('showMyReviewFilter')
    // 回访分支筛选键清单不含 myReview
    const keysDef = source.split('FEEDBACK_CUSTOMER_VISIT_COMPOSITE_KEYS')[1]?.slice(0, 200) || ''
    expect(keysDef).not.toContain('myReview')
  })
})
