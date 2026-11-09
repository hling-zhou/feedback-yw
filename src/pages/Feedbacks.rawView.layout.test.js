import fs from 'node:fs'
import { describe, expect, it } from 'vitest'

describe('Feedbacks post-use raw view（原始数据 tab 去详情抽屉，2026-11-09 拍板）', () => {
  const source = fs.readFileSync(new URL('./Feedbacks.jsx', import.meta.url), 'utf8')
  const tableSrc = fs.readFileSync(
    new URL('../components/FeedbackTable.jsx', import.meta.url),
    'utf8',
  )

  it('raw 视图表格与卡片均不可点击开抽屉（工单 lane 照常）', () => {
    // 表格/卡片消费处：postUse lane 传 undefined
    expect(source).toContain('onSelect={isPostUseLane ? undefined : selectFeedback}')
    // 出现两处（FeedbackTable + CardGrid）——split N 次得 N+1 段，锁死防止一处漏改回潮
    expect(source.split('onSelect={isPostUseLane ? undefined : selectFeedback}').length).toBe(3)
    // FeedbackDrawer 渲染条件收窄到工单 lane
    expect(source).toContain('{!isCustomerVisitLane && !isPostUseLane ? (')
    expect(source).toContain('<FeedbackDrawer')
  })

  it('CardGrid 点击与手型样式跟随 onSelect 可选化', () => {
    expect(source).toContain("className={onSelect ? 'page-card page-card-bordered cursor-pointer' : 'page-card page-card-bordered'}")
    expect(source).toContain('onClick={onSelect ? () => onSelect(fb) : undefined}')
  })

  it('FeedbackTable：onRow 条件绑定 + 原文列内放大查看（纯只读）', () => {
    // onSelect 不传时行不可点击（无 onRow 绑定）
    expect(tableSrc).toContain('onRow={onSelect')
    expect(tableSrc).toContain('? (record) => ({')
    // 原文列放大按钮 + 只读 Modal
    expect(tableSrc).toContain('放大查看')
    expect(tableSrc).toContain('setViewingRaw(fb)')
    expect(tableSrc).toContain('footer={null}')
    // 防御：放大按钮点击不冒泡触发行点击
    expect(tableSrc).toContain('e.stopPropagation()')
  })

  it('批量旅程补全横幅保留（不依赖抽屉）', () => {
    expect(source).toContain("postUseLaneView === POST_USE_VIEW_RAW && pendingJourneyCount > 0")
    expect(source).toContain('补全用户旅程')
  })
})
