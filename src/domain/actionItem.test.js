import { describe, expect, it } from 'vitest'
import {
  ACTION_ITEM_STATUS_LABELS,
  aggregateActionItemsByProductStatus,
  canDeleteActionItem,
  computeScheduleChanged,
  deriveActionItemStatusFromSchedule,
  linkTicketToActionItem,
  mergeActionItemPatch,
  recomputeActionItemLinkedDataSources,
  unlinkTicketFromActionItem,
  validateActionItemCreate,
  toActionItemCreateBody,
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

  it('toActionItemCreateBody strips server-only fields', () => {
    const created = validateActionItemCreate({ content: '举措A' })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(toActionItemCreateBody(created.item)).toEqual({
      content: '举措A',
      detail: '',
      productKey: '',
      productName: '',
      status: 'pending_evaluation',
      firstProposedAt: created.item.firstProposedAt,
      scheduleAt: '',
      painPointSnapshot: '',
      problemTypeSnapshot: '',
      journeyL1Snapshot: '',
      linkedTicketIds: [],
      linkedRequirementTicketIds: [],
      linkedDataSources: [],
      scheduleChanged: false,
      warningLevel: 'none',
    })
    expect(toActionItemCreateBody(created.item)).not.toHaveProperty('id')
    expect(toActionItemCreateBody(created.item)).not.toHaveProperty('createdAt')
  })

  it('does not derive status from schedule when requirement tickets are linked', () => {
    const base = validateActionItemCreate({
      id: 'act-req',
      content: '举措关联',
      status: 'in_progress',
      scheduleAt: '2026-06-01',
      linkedRequirementTicketIds: ['REQ-1'],
    })
    expect(base.ok).toBe(true)
    if (!base.ok) return

    const merged = mergeActionItemPatch(base.item, { detail: '仅改详情' })
    expect(merged.ok).toBe(true)
    if (!merged.ok) return
    expect(merged.item.status).toBe('in_progress')
    expect(merged.item.scheduleAt).toBe('2026-06-01')
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
    expect(unlinked.linkedDataSources).toEqual([])
    expect(unlinked.painPointSnapshot).toBe('')
  })

  it('canDeleteActionItem blocks when feedback tickets linked', () => {
    const created = validateActionItemCreate({
      content: '不可删',
      linkedTicketIds: ['T-1'],
      linkedDataSources: ['complaint_ticket'],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return
    expect(canDeleteActionItem(created.item).ok).toBe(false)

    const empty = validateActionItemCreate({ content: '可删' })
    expect(empty.ok).toBe(true)
    if (!empty.ok) return
    expect(canDeleteActionItem(empty.item).ok).toBe(true)

    const reqOnly = validateActionItemCreate({
      content: '仅需求',
      linkedRequirementTicketIds: ['REQ-1'],
    })
    expect(reqOnly.ok).toBe(true)
    if (!reqOnly.ok) return
    expect(canDeleteActionItem(reqOnly.item).ok).toBe(true)
  })

  it('recomputeActionItemLinkedDataSources keeps remaining ticket sources', () => {
    const created = validateActionItemCreate({
      content: '举措C',
      linkedTicketIds: ['T-1', 'T-2'],
      linkedDataSources: ['complaint_ticket', 'consultation_ticket'],
    })
    expect(created.ok).toBe(true)
    if (!created.ok) return

    const unlinked = unlinkTicketFromActionItem(created.item, 'T-1')
    const map = new Map([
      ['T-2', 'consultation_ticket'],
    ])
    const next = recomputeActionItemLinkedDataSources(unlinked, map)
    expect(next.linkedTicketIds).toEqual(['T-2'])
    expect(next.linkedDataSources).toEqual(['consultation_ticket'])
  })

  it('aggregateActionItemsByProductStatus sums linked feedback by status', () => {
    const rows = aggregateActionItemsByProductStatus(
      [
        {
          id: 'a1',
          productKey: 'vpc',
          productName: 'VPC',
          content: 'A',
          status: 'in_progress',
          linkedTicketIds: ['T-1', 'T-2'],
          createdAt: '',
          updatedAt: '',
        },
        {
          id: 'a2',
          productKey: 'vpc',
          productName: 'VPC',
          content: 'B',
          status: 'pending_evaluation',
          linkedTicketIds: ['T-3'],
          createdAt: '',
          updatedAt: '',
        },
      ],
      { periodTicketIdSet: new Set(['T-1', 'T-3']) },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].counts.in_progress).toBe(1)
    expect(rows[0].linkedFeedbackCounts.in_progress).toBe(1)
    expect(rows[0].linkedFeedbackCounts.pending_evaluation).toBe(1)
    expect(rows[0].linkedFeedbackTotal).toBe(2)
  })

  it('status labels cover all statuses', () => {
    expect(ACTION_ITEM_STATUS_LABELS.pending_evaluation).toBe('待评估')
    expect(ACTION_ITEM_STATUS_LABELS.in_progress).toBe('进行中')
  })
})
