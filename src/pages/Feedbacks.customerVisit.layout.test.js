import fs from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Feedbacks customer visit tab', () => {
  const source = fs.readFileSync(new URL('./Feedbacks.jsx', import.meta.url), 'utf8')

  it('includes a read-only customer visit tab with composite search and export', () => {
    expect(source).toContain('FEEDBACK_LANE_CUSTOMER_VISITS')
    expect(source).toContain('省代表回访')
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

  it('2026-11-10 列表列 = 导入模板列（4 固定列 + 模板列序，无推荐分析列）', () => {
    const afterTable = source.split('function CustomerVisitTable')[1] || ''
    const tableBlock = afterTable.split('function CardGrid')[0] || afterTable
    // 列定义形态断言（避开注释文字）：被移除列的列定义形态（title: 'xxx'）不得回潮
    expect(tableBlock).not.toContain("title: '建议触发类型'")
    expect(tableBlock).not.toContain("title: '7分以下分布'")
    expect(tableBlock).not.toContain("title: '建议回访原因'")
    // 动态列生成器（客户原话N/低分原因N）不得回潮
    expect(tableBlock).not.toContain('Array.from({ length: maxQuotes }')
    expect(tableBlock).not.toContain('Array.from({ length: maxReasons }')
    // 4 固定列
    expect(tableBlock).toContain("title: '评估状态'")
    expect(tableBlock).toContain("title: '数据月份'")
    expect(tableBlock).toContain("title: '产品名称'")
    expect(tableBlock).toContain("title: '客户名称'")
    // 模板列（相应投诉工单/客户反馈/回访结果/内部评估/备注/经办人）
    expect(tableBlock).toContain("title: '相应投诉工单'")
    expect(tableBlock).toContain("title: '客户反馈'")
    // 2026-11-10 拍板：集团名称列从列表去掉——回潮即红
    expect(tableBlock).not.toContain("title: '集团名称'")
  })

  it('2026-11-10 客户编码 220 不截断 + 客户名称/登录账号名称 hover 气泡（参考工单列表）', () => {
    const afterTable = source.split('function CustomerVisitTable')[1] || ''
    const tableBlock = afterTable.split('function CardGrid')[0] || afterTable
    // 客户编码列宽 220（主流 20 字符编码完整显示），无 ellipsis（不截断即无省略号）
    expect(tableBlock).toMatch(/title: '客户编码'[^}]*width: 220/)
    expect(tableBlock).not.toMatch(/title: '客户编码'[^}]*ellipsis/)
    // 客户名称/登录账号名称：Tooltip 气泡 render（截断时 hover 完整显示）
    expect(tableBlock).toMatch(/title: '客户名称'[\s\S]{0,220}Tooltip title=/)
    expect(tableBlock).toMatch(/title: '登录账号名称'[\s\S]{0,220}Tooltip title=/)
    // 溯源 tab 同款：PostUseJiraTab 客户编码 220 + 客户名称 Tooltip
    const jiraSource = fs.readFileSync(join(__dirname, 'PostUseJiraTab.jsx'), 'utf8')
    expect(jiraSource).toMatch(/title: '客户编码',[^}]*width: 220/)
    expect(jiraSource).toMatch(/title: '客户名称'[\s\S]{0,260}Tooltip title=/)
  })
})
