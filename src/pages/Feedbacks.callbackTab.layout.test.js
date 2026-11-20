import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

/**
 * 反馈库宿主接线守卫（T3，2026-11-21 建议回访/溯源清单 tab 接入）。
 *
 * 锚点：
 * 1. Segmented 选项从 POST_USE_LANE_VIEWS 单源派生（禁止独立硬编码数组回潮）；
 * 2. callback 项受 canViewPostUseCallbackListTab 门控，无权限不渲染；
 * 3. 无权限直达 view=callback 一律 fallback raw（在宿主层，域层只管解析）；
 * 4. 渲染分支存在 isPostUseCallbackView → PostUseCallbackListTab；
 * 5. FeedbackDrawer 挂载条件含 callback 视图例外（原工单跳转）；
 * 6. 存档「立即查看」走同页视图切换（switchPostUseLaneView），非整页 navigate。
 */

const source = fs.readFileSync(new URL('./Feedbacks.jsx', import.meta.url), 'utf8')
const domainSource = fs.readFileSync(
  new URL('../domain/postUseRatingImport.js', import.meta.url),
  'utf8',
)

describe('Feedbacks 宿主接线：建议回访/溯源清单视图（2026-11-21）', () => {
  it('Segmented 选项单源派生：POST_USE_LANE_VIEWS.filter + label 映射，禁独立数组', () => {
    expect(source).toContain('options={POST_USE_LANE_VIEWS.filter(')
    expect(source).toContain('POST_USE_VIEW_LABELS[view]')
    expect(source).toContain('const POST_USE_VIEW_LABELS')
    // 旧三视图硬编码数组不得回潮
    expect(source).not.toContain("{ label: '原始数据', value: POST_USE_VIEW_RAW }")
  })

  it('callback 项可见性门控：canViewPostUseCallbackListTab（admin ∨ 用户名白名单）', () => {
    expect(source).toContain('canViewPostUseCallbackListTab')
    expect(source).toContain('view !== POST_USE_VIEW_CALLBACK || canViewCallbackListTab')
  })

  it('无权限直达 view=callback fallback raw（宿主层，域层白名单只管解析）', () => {
    expect(source).toContain('resolvedPostUseLaneView === POST_USE_VIEW_CALLBACK && !canViewCallbackListTab')
    // 域层白名单仍含 callback（解析层不设权限），域测试锚定
    expect(domainSource).toContain("('callback')")
  })

  it('渲染分支：isPostUseCallbackView → PostUseCallbackListTab，回调注入', () => {
    expect(source).toContain('isPostUseCallbackView ? (')
    expect(source).toContain('<PostUseCallbackListTab')
    expect(source).toContain('onOpenTicket={(record) => selectFeedback(record)}')
    expect(source).toContain('onNavigateToTrace={() => switchPostUseLaneView(POST_USE_VIEW_TRACE)}')
  })

  it('FeedbackDrawer 挂载条件含 callback 视图例外', () => {
    expect(source).toContain('!isCustomerVisitLane && (!isPostUseLane || isPostUseCallbackView) ? (')
  })

  it('共享 sticky chrome 在 callback 视图不渲染（防双层叠压 + 无效按钮误导，11-09 拍板同款排除）', () => {
    expect(source).toContain('{!isPostUseTraceView && !isPostUseCallbackView && (')
  })

  it('libraryLoading 对 callback 视图计入评价数据加载（else 分支 periodsLoading || feedbacksLoading || postUseListLoading）', () => {
    // callback 视图不在 isPostUseTraceView 特例分支（其 loading 只看 periodsLoading），
    // 走通用分支：评价按月加载在途时显示 loading，避免空清单假象
    expect(source).toContain('const libraryLoading =\n    isPostUseTraceView\n      ? periodsLoading')
  })
})
