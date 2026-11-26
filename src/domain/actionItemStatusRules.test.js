import { describe, expect, it } from 'vitest'
import { mergeActionItemPatch, validateActionItemCreate } from './actionItem.js'
import {
  isAllowedActionItemStatusTransition,
  isActionItemLocked,
  validateActionItemPatchAllowed,
  validateActionItemRequirementLinkPatchAllowed,
} from './actionItemStatusRules.js'

describe('actionItemStatusRules', () => {
  it('allows not_implemented from pending_evaluation only', () => {
    expect(isAllowedActionItemStatusTransition('pending_evaluation', 'not_implemented')).toBe(true)
    expect(isAllowedActionItemStatusTransition('in_progress', 'not_implemented')).toBe(false)
  })

  it('allows abnormal_terminated from in_progress or suspended', () => {
    expect(isAllowedActionItemStatusTransition('in_progress', 'abnormal_terminated')).toBe(true)
    expect(isAllowedActionItemStatusTransition('suspended', 'abnormal_terminated')).toBe(true)
    expect(isAllowedActionItemStatusTransition('pending_evaluation', 'abnormal_terminated')).toBe(
      false,
    )
  })

  it('locks completed, not_implemented, abnormal_terminated', () => {
    expect(isActionItemLocked('completed')).toBe(true)
    expect(isActionItemLocked('not_implemented')).toBe(true)
    expect(isActionItemLocked('abnormal_terminated')).toBe(true)
    expect(isActionItemLocked('in_progress')).toBe(false)
  })

  describe('completedAt 实际完成时间（11-25 拍板：A 自动记录 + B 人工修正，仅 completed 态可填）', () => {
    const inProgress = () => {
      const created = validateActionItemCreate({
        content: '举措X',
        status: 'in_progress',
        scheduleAt: '2026-06-01',
      })
      if (!created.ok) throw new Error(created.error)
      return created.item
    }

    it('切换到 completed 时自动写入 completedAt（YYYY-MM-DD）', () => {
      const merged = mergeActionItemPatch(inProgress(), { status: 'completed' })
      expect(merged.ok).toBe(true)
      if (!merged.ok) return
      expect(merged.item.status).toBe('completed')
      expect(merged.item.completedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    })

    it('completed 态允许人工修正 completedAt（B 通道）', () => {
      const done = mergeActionItemPatch(inProgress(), { status: 'completed' })
      if (!done.ok) return
      const fixed = mergeActionItemPatch(done.item, { completedAt: '2026-06-15' })
      expect(fixed.ok).toBe(true)
      if (fixed.ok) expect(fixed.item.completedAt).toBe('2026-06-15')
    })

    it('非 completed 态填 completedAt 被拒绝（拍板：仅 completed 态可填）', () => {
      const result = mergeActionItemPatch(inProgress(), { completedAt: '2026-06-15' })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.error).toMatch(/完成时间/)
    })

    it('创建时非 completed 态带 completedAt 被拒绝', () => {
      const created = validateActionItemCreate({
        content: '举措Y',
        status: 'in_progress',
        scheduleAt: '2026-06-01',
        completedAt: '2026-06-15',
      })
      expect(created.ok).toBe(false)
      if (!created.ok) expect(created.error).toMatch(/完成时间/)
    })

    it('创建时 completed 态带 completedAt 采纳', () => {
      const created = validateActionItemCreate({
        content: '举措Z',
        status: 'completed',
        scheduleAt: '2026-06-01',
        completedAt: '2026-06-15',
      })
      expect(created.ok).toBe(true)
      if (created.ok) expect(created.item.completedAt).toBe('2026-06-15')
    })

    it('completed 态清空 completedAt 被拒绝（终态锁定，防误清）', () => {
      const done = mergeActionItemPatch(inProgress(), { status: 'completed' })
      if (!done.ok) return
      const cleared = mergeActionItemPatch(done.item, { completedAt: '' })
      expect(cleared.ok).toBe(false)
    })
  })

  it('merge clears schedule and blocks edits on locked items', () => {
    const created = validateActionItemCreate({
      content: '举措A',
      status: 'in_progress',
      scheduleAt: '2026-06-01',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const toNotImplemented = mergeActionItemPatch(created.item, { status: 'not_implemented' })
    expect(toNotImplemented.ok).toBe(false)

    const pending = validateActionItemCreate({
      content: '举措B',
      status: 'pending_evaluation',
      scheduleAt: '',
    })
    expect(pending.ok).toBe(true)
    if (!pending.ok) return

    const merged = mergeActionItemPatch(pending.item, { status: 'not_implemented' })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.item.status).toBe('not_implemented')
    expect(merged.item.scheduleAt).toBe('')
    expect(merged.item.warningLevel).toBe('none')

    expect(validateActionItemPatchAllowed(merged.item, { content: '改内容' })).toMatch(
      /不能修改内容/,
    )
  })

  it('rejects in_progress without schedule on create and transition', () => {
    const created = validateActionItemCreate({
      content: '举措D',
      status: 'in_progress',
      scheduleAt: '',
    })
    expect(created.ok).toBe(false)
    if (created.ok) return
    expect(created.error).toMatch(/排期/)

    const suspended = validateActionItemCreate({
      content: '举措E',
      status: 'suspended',
      scheduleAt: '',
    })
    expect(suspended.ok).toBe(true)
    if (!suspended.ok) return

    const toInProgress = mergeActionItemPatch(suspended.item, { status: 'in_progress' })
    expect(toInProgress.ok).toBe(false)
    if (toInProgress.ok) return
    expect(toInProgress.error).toMatch(/排期/)
  })

  it('blocks content, status, and schedule edits while requirement tickets are linked', () => {
    const created = validateActionItemCreate({
      content: '举措F',
      status: 'in_progress',
      scheduleAt: '2026-06-01',
      linkedRequirementTicketIds: ['REQ-1'],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    expect(validateActionItemRequirementLinkPatchAllowed(created.item, { content: '新内容' })).toMatch(
      /不能修改举措内容/,
    )
    expect(validateActionItemRequirementLinkPatchAllowed(created.item, { status: 'completed' })).toMatch(
      /不能修改状态/,
    )
    expect(
      validateActionItemRequirementLinkPatchAllowed(created.item, { scheduleAt: '2026-07-01' }),
    ).toMatch(/不能修改排期/)

    const detailOnly = mergeActionItemPatch(created.item, {
      detail: '更新详情',
      linkedRequirementTicketIds: ['REQ-1', 'REQ-2'],
    })
    expect(detailOnly.ok).toBe(true)
    if (!detailOnly.ok) return
    expect(detailOnly.item.detail).toBe('更新详情')
    expect(detailOnly.item.content).toBe('举措F')
    expect(detailOnly.item.scheduleAt).toBe('2026-06-01')
    expect(detailOnly.item.status).toBe('in_progress')
  })

  it('allows unlinking requirement tickets while preserving frozen snapshot fields', () => {
    const created = validateActionItemCreate({
      content: '举措H',
      status: 'in_progress',
      scheduleAt: '2026-06-01',
      linkedRequirementTicketIds: ['REQ-1'],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const unlinked = mergeActionItemPatch(created.item, {
      linkedRequirementTicketIds: [],
      detail: '保留详情',
    })
    expect(unlinked.ok).toBe(true)
    if (!unlinked.ok) return
    expect(unlinked.item.linkedRequirementTicketIds).toEqual([])
    expect(unlinked.item.content).toBe('举措H')
    expect(unlinked.item.status).toBe('in_progress')
    expect(unlinked.item.scheduleAt).toBe('2026-06-01')
    expect(unlinked.item.detail).toBe('保留详情')
  })

  it('rejects linking requirement tickets together with content changes', () => {
    const created = validateActionItemCreate({
      content: '举措G',
      status: 'pending_evaluation',
      scheduleAt: '',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const merged = mergeActionItemPatch(created.item, {
      linkedRequirementTicketIds: ['REQ-9'],
      content: '改动内容',
    })
    expect(merged.ok).toBe(false)
    if (merged.ok) return
    expect(merged.error).toMatch(/不能同时修改/)
  })

  it('abnormal_terminated from in_progress clears schedule', () => {
    const created = validateActionItemCreate({
      content: '举措C',
      status: 'in_progress',
      scheduleAt: '2026-07-01',
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const merged = mergeActionItemPatch(created.item, { status: 'abnormal_terminated' })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.item.scheduleAt).toBe('')
    expect(merged.item.warningLevel).toBe('none')
  })
})
