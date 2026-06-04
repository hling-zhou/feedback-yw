import { describe, expect, it } from 'vitest'
import { mergeActionItemPatch, validateActionItemCreate } from './actionItem.js'
import {
  isAllowedActionItemStatusTransition,
  isActionItemLocked,
  validateActionItemPatchAllowed,
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
