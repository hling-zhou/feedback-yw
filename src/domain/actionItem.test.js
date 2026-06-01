import { describe, expect, it } from 'vitest'
import {
  ACTION_ITEM_STATUS_LABELS,
  computeScheduleChanged,
  deriveActionItemStatusFromSchedule,
  linkTicketToActionItem,
  mergeActionItemPatch,
  unlinkTicketFromActionItem,
  validateActionItemCreate,
} from './actionItem.js'

describe('actionItem', () => {
  it('deriveActionItemStatusFromSchedule maps empty to 待评估', () => {
    expect(deriveActionItemStatusFromSchedule('')).toBe('pending_evaluation')
    expect(deriveActionItemStatusFromSchedule('2026-Q2')).toBe('in_progress')
  })

  it('computeScheduleChanged only when previous schedule was non-empty', () => {
    expect(computeScheduleChanged('', '2026-08-01')).toBe(false)
    expect(computeScheduleChanged('2026-07-01', '2026-08-01')).toBe(true)
    expect(computeScheduleChanged('2026-07-01', '')).toBe(true)
    expect(computeScheduleChanged('2026-07-01', '2026-07-01')).toBe(false)
  })

  it('validateActionItemCreate requires content', () => {
    expect(validateActionItemCreate({ content: '' }).ok).toBe(false)
    const created = validateActionItemCreate({ content: '优化控制台体验' })
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.item.status).toBe('pending_evaluation')
      expect(created.item.firstProposedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('mergeActionItemPatch sets in_progress when schedule added from empty without scheduleChanged', () => {
    const base = validateActionItemCreate({
      id: 'act-1',
      content: '举措A',
      scheduleAt: '',
    })
    expect(base.ok).toBe(true)
    if (!base.ok) return

    const merged = mergeActionItemPatch(base.item, { scheduleAt: '2026-08-01' })
    expect(merged.ok).toBe(true)
    if (merged.ok) {
      expect(merged.item.scheduleAt).toBe('2026-08-01')
      expect(merged.item.status).toBe('in_progress')
      expect(merged.item.scheduleChanged).toBe(false)
    }
  })

  it('mergeActionItemPatch marks scheduleChanged when rescheduling non-empty date', () => {
    const base = validateActionItemCreate({
      id: 'act-2',
      content: '举措B',
      scheduleAt: '2026-07-01',
      status: 'in_progress',
    })
    expect(base.ok).toBe(true)
    if (!base.ok) return

    const merged = mergeActionItemPatch(base.item, { scheduleAt: '2026-08-01' })
    expect(merged.ok).toBe(true)
    if (merged.ok) {
      expect(merged.item.scheduleChanged).toBe(true)
    }
  })

  it('mergeActionItemPatch clears status to pending_evaluation when schedule cleared', () => {
    const base = validateActionItemCreate({
      id: 'act-3',
      content: '举措C',
      scheduleAt: '2026-07-01',
      status: 'in_progress',
    })
    expect(base.ok).toBe(true)
    if (!base.ok) return

    const merged = mergeActionItemPatch(base.item, { scheduleAt: '' })
    expect(merged.ok).toBe(true)
    if (merged.ok) {
      expect(merged.item.status).toBe('pending_evaluation')
      expect(merged.item.scheduleChanged).toBe(true)
    }
  })

  it('link and unlink ticket ids', () => {
    const created = validateActionItemCreate({ content: '举措B' })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const linked = linkTicketToActionItem(created.item, 'T-100', 'complaint_ticket')
    expect(linked.linkedTicketIds).toEqual(['T-100'])
    expect(linked.linkedDataSources).toEqual(['complaint_ticket'])

    const unlinked = unlinkTicketFromActionItem(linked, 'T-100')
    expect(unlinked.linkedTicketIds).toEqual([])
  })

  it('status labels cover all statuses', () => {
    expect(ACTION_ITEM_STATUS_LABELS.pending_evaluation).toBe('待评估')
    expect(ACTION_ITEM_STATUS_LABELS.in_progress).toBe('进行中')
  })
})
