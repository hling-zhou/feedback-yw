import { describe, expect, it } from 'vitest'
import {
  ACTION_ITEM_STATUS_LABELS,
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

  it('validateActionItemCreate requires content', () => {
    expect(validateActionItemCreate({ content: '' }).ok).toBe(false)
    const created = validateActionItemCreate({ content: '优化控制台体验' })
    expect(created.ok).toBe(true)
    if (created.ok) {
      expect(created.item.status).toBe('pending_evaluation')
      expect(created.item.firstProposedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    }
  })

  it('mergeActionItemPatch updates schedule and sets scheduleChanged', () => {
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
