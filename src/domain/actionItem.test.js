import { describe, expect, it } from 'vitest'
import {
  ACTION_ITEM_STATUS_LABELS,
  aggregateActionItemsByProductStatus,
  computeActionItemCompletionRate,
  computeScheduleChanged,
  countActionItemLinkedFeedbackTickets,
  deriveActionItemStatusFromSchedule,
  linkTicketToActionItem,
  mergeActionItemPatch,
  recomputeActionItemLinkedDataSources,
  resolveActionItemProductDisplayName,
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
      source: 'ticket',
      status: 'pending_evaluation',
      firstProposedAt: created.item.firstProposedAt,
      scheduleAt: '',
      painPointSnapshot: '',
      problemTypeSnapshot: '',
      journeyL1Snapshot: '',
      journeyL2Snapshot: '',
      linkedTicketIds: [],
      linkedRequirementTicketIds: [],
      linkedDataSources: [],
      scheduleChanged: false,
      warningLevel: 'none',
    })
    expect(toActionItemCreateBody(created.item)).not.toHaveProperty('id')
    expect(toActionItemCreateBody(created.item)).not.toHaveProperty('createdAt')
  })

  it('keeps post-use source when creating a library action', () => {
    const created = validateActionItemCreate({ content: '回访举措', source: 'post_use' })
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.item.source).toBe('post_use')
  })

  it('keeps api_patrol source when creating a library action（11-24：归一层放行，不再回落 ticket）', () => {
    const created = validateActionItemCreate({ content: '巡检举措', source: 'api_patrol' })
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.item.source).toBe('api_patrol')
  })

  it('normalizes unknown source values back to ticket', () => {
    // @ts-expect-error 测试意图即传入非法值验证兜底归一
    const created = validateActionItemCreate({ content: '兜底举措', source: 'bogus' })
    expect(created.ok).toBe(true)
    if (created.ok) expect(created.item.source).toBe('ticket')
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

  it('countActionItemLinkedFeedbackTickets counts only real ticket links (2026-11-25 删除放开)', () => {
    // 红证锚点：linkedDataSources 非空但 linkedTicketIds 为空（误报形态，先例：
    // TicketDashboardView createAction 无工单路径塞来源标签）不得计入关联数
    const sourceOnly = validateActionItemCreate({
      content: '改善「配额申请与提升」相关问题',
      linkedTicketIds: [],
      linkedDataSources: ['consultation_ticket'],
    })
    expect(sourceOnly.ok).toBe(true)
    if (sourceOnly.ok) {
      expect(countActionItemLinkedFeedbackTickets(sourceOnly.item)).toBe(0)
    }

    const linked = validateActionItemCreate({
      content: '已关联反馈',
      linkedTicketIds: ['T-1', ''],
      linkedDataSources: ['complaint_ticket'],
    })
    expect(linked.ok).toBe(true)
    if (linked.ok) {
      expect(countActionItemLinkedFeedbackTickets(linked.item)).toBe(1)
    }

    expect(countActionItemLinkedFeedbackTickets(null)).toBe(0)
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

  it('computeActionItemCompletionRate is completed over all statuses', () => {
    expect(
      computeActionItemCompletionRate({
        pending_evaluation: 1,
        in_progress: 1,
        completed: 2,
        suspended: 0,
        not_implemented: 0,
        abnormal_terminated: 0,
      }),
    ).toBe(50)
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
    expect(rows[0].rate).toBe(0)
  })

  it('resolveActionItemProductDisplayName prefers catalog name over stored spec name', () => {
    const productNameByKey = new Map([['eip', '弹性公网IP']])
    expect(
      resolveActionItemProductDisplayName(
        { productKey: 'eip', productName: '弹性公网IP-移动IP' },
        productNameByKey,
      ),
    ).toBe('弹性公网IP')
  })

  it('aggregateActionItemsByProductStatus uses catalog product name for chart labels', () => {
    const productNameByKey = new Map([['eip', '弹性公网IP']])
    const rows = aggregateActionItemsByProductStatus(
      [
        {
          id: 'a1',
          productKey: 'eip',
          productName: '弹性公网IP-移动IP',
          content: 'A',
          status: 'in_progress',
          linkedTicketIds: [],
          createdAt: '',
          updatedAt: '',
        },
      ],
      { productNameByKey },
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].productName).toBe('弹性公网IP')
  })

  it('status labels cover all statuses', () => {
    expect(ACTION_ITEM_STATUS_LABELS.pending_evaluation).toBe('待评估')
    expect(ACTION_ITEM_STATUS_LABELS.in_progress).toBe('进行中')
  })
})
