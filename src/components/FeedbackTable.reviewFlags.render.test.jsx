/**
 * 双标记行（纳入听音 × 讨论状态）真渲染守卫——renderToStaticMarkup 全六组合。
 * 纯视觉/Sticky 类单测够不着，但「某形态下 Checkbox/Tag 是否渲染、footer 听音是否下线」
 * 是结构行为，用真渲染断言（2026-11-25 双标记实施产物）。
 *
 * FeedbackDrawer 依赖 context/路由太重，此处直接渲染源码级标记行 JSX 片段
 * 由 layout.test.js 源码锚定兜底；本文件验证消费级渲染：
 * FeedbackTable 复核标记列 + Feedbacks 卡片 Tag 的真实 DOM 输出。
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import FeedbackTable from './FeedbackTable.jsx'
import { normalizeDiscussionStatus } from '../domain/discussionStatus.js'

const baseItems = (record) => [
  {
    id: 'r1',
    ticketId: 'TS-1001',
    dataSourceType: 'complaint_ticket',
    ...record,
  },
]

function renderTable(record) {
  // eslint-disable-next-line react/no-children-prop
  return renderToStaticMarkup(
    createElement(FeedbackTable, {
      items: baseItems(record),
      dataSource: 'complaint_ticket',
      reviewEnabled: false,
      hiddenColumns: new Set(),
      stickyOffset: 0,
    }),
  )
}

describe('FeedbackTable 复核标记列渲染（双标记六组合）', () => {
  it('无标记 → 列输出「—」', () => {
    const html = renderTable({})
    expect(html).toContain('复核标记')
    expect(normalizeDiscussionStatus(undefined)).toBe('')
    // 无标记行：复核标记列不出现任何标记 Tag 文案
    const cell = html.split('复核标记')[1]?.slice(0, 400) || ''
    expect(cell).not.toContain('纳入听音')
    expect(cell).not.toContain('待讨论')
    expect(cell).not.toContain('已讨论')
  })

  it('仅纳入听音 → 纳入听音 Tag', () => {
    const html = renderTable({ listeningReviewed: true })
    expect(html).toContain('纳入听音')
    expect(html).not.toContain('待讨论</span>')
  })

  it('仅待讨论 → 待讨论 Tag', () => {
    const html = renderTable({ discussionStatus: 'pending' })
    expect(html).toContain('待讨论')
    expect(html).not.toContain('纳入听音')
  })

  it('仅已讨论 → 已讨论 Tag（老数据 undefined 归一不误显）', () => {
    const html = renderTable({ discussionStatus: 'done' })
    expect(html).toContain('已讨论')
    expect(html).not.toContain('待讨论')
  })

  it('双标记（纳入听音 + 待讨论）→ 两 Tag 并存', () => {
    const html = renderTable({ listeningReviewed: true, discussionStatus: 'pending' })
    expect(html).toContain('纳入听音')
    expect(html).toContain('待讨论')
  })

  it('全终态（纳入听音 + 已讨论）→ 两绿 Tag 并存', () => {
    const html = renderTable({ listeningReviewed: true, discussionStatus: 'done' })
    expect(html).toContain('纳入听音')
    expect(html).toContain('已讨论')
    expect(html).not.toContain('待讨论')
  })

  it('非法 discussionStatus 值归一为未标记（不渲染讨论 Tag）', () => {
    const html = renderTable({ discussionStatus: 'garbage' })
    const cell = html.split('复核标记')[1]?.slice(0, 400) || ''
    expect(cell).not.toContain('待讨论')
    expect(cell).not.toContain('已讨论')
  })
})
