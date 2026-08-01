import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

/**
 * 工单详情抽屉三区布局：工单内容 → 工单分析 → 工单分类（锚点导航在标题行）。
 */
describe('FeedbackDrawer layout', () => {
  const src = readFileSync(
    resolve(import.meta.dirname, 'FeedbackDrawer.jsx'),
    'utf8',
  )

  function marker(label) {
    const index = src.indexOf(label)
    expect(index, `missing marker: ${label}`).toBeGreaterThan(-1)
    return index
  }

  it('places anchor nav in drawer title and orders content sections', () => {
    const nav = marker("aria-label={postUse ? '评价详情分区导航' : '工单详情分区导航'}")
    marker('TicketDetailDrawerTitle')
    const meta = marker('metaLine={ticketMetaLine}')
    const content = marker('id="ticket-detail-content"')
    const handling = marker('title="处理意见（工单原文）"')
    const rootCause = marker('title="根因排查"')
    const followUp = marker('title="回访满意度"')
    const analysis = marker("id={isPostUseLibrary ? 'rating-detail-analysis' : 'ticket-detail-analysis'}")
    const request = marker('shrink-0">客户请求内容</span>')
    const pain = marker('shrink-0">需求痛点挖掘</span>')
    const opt = marker('title="优化建议"')
    const note = marker('title="备注"')
    const classification = marker("id={isPostUseLibrary ? 'rating-detail-classification' : 'ticket-detail-classification'}")
    const tags = marker('dimension="requestScene"')
    const causeFinal = marker('投诉原因（终判）')
    const causeReview = marker('二级（人工复核）')

    expect(src).toMatch(/title=\{[\s\S]*TicketDetailDrawerTitle/)
    expect(src).toContain('justify-center')
    expect(nav).toBeLessThan(meta)
    expect(meta).toBeLessThan(content)
    expect(content).toBeLessThan(handling)
    expect(handling).toBeLessThan(followUp)
    expect(followUp).toBeLessThan(analysis)
    expect(analysis).toBeLessThan(request)
    expect(request).toBeLessThan(pain)
    expect(pain).toBeLessThan(rootCause)
    expect(rootCause).toBeLessThan(opt)
    expect(opt).toBeLessThan(note)
    expect(note).toBeLessThan(classification)
    expect(classification).toBeLessThan(tags)
    expect(tags).toBeLessThan(causeFinal)
    expect(causeFinal).toBeLessThan(causeReview)
    expect(src).toContain('closable={{ placement: \'end\' }}')
    expect(src).toContain('TICKET_DETAIL_DRAWER_WIDTH')
    expect(src).toContain('HandlingOriginalTextModal')
    expect(src).toContain('放大查看')
  })

  it('uses rating-specific title, anchors, and journey-only classification', () => {
    expect(src).toContain("{ id: 'rating-detail-content', label: '评价内容' }")
    expect(src).toContain("{ id: 'rating-detail-analysis', label: '评价分析' }")
    expect(src).toContain("{ id: 'rating-detail-classification', label: '评价分类' }")
    expect(src).toContain("{postUse ? '评价详情' : '工单详情'}")
    expect(src).toContain('isPostUseLibrary ? (\n            canEdit ? (')
    expect(src).toContain('!isPostUseLibrary && hasDetailOptimizationContent(feedback)')
  })

  it('exposes scroll helper and hides horizontal overflow in drawer body', () => {
    expect(src).toContain('scrollToTicketDetailSection')
    expect(src).toContain('scrollIntoView')
    expect(src).toContain('overflowX: \'hidden\'')
  })

  it('delegates close to parent and tracks dirty state for leave confirm', () => {
    expect(src).toContain('handleRequestClose')
    expect(src).toContain('areFeedbackDrawerFormSnapshotsEqual')
    expect(src).not.toContain('confirmDiscardFeedbackDrawerEdits')
    expect(src).toContain('onDirtyChange')
    expect(src).toContain('onSavedClose')
    expect(src).toContain('applyFeedbackToForm(merged)')
    expect(src).toContain('onDirtyChange?.(false)')
  })
})
