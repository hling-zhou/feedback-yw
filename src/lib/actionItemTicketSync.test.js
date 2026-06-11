import { describe, expect, it } from 'vitest'
import { buildTicketCopyPatchForActionItem } from './actionItemTicketSync.js'

describe('actionItemTicketSync', () => {
  const baseItem = {
    id: 'act-1',
    content: '优化控制台',
    detail: '补充说明',
    status: 'in_progress',
    scheduleAt: '2026-08-01',
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  }

  it('syncs content, detail, and schedule when not linked to requirement tickets', () => {
    const patch = buildTicketCopyPatchForActionItem({
      ...baseItem,
      linkedRequirementTicketIds: [],
    })
    expect(patch.establishedAction).toBe('优化控制台')
    expect(patch.establishedActionDetail).toBe('补充说明')
    expect(patch.actionSchedule).toBe('2026-08-01')
  })

  it('syncs detail only when linked to requirement tickets', () => {
    const patch = buildTicketCopyPatchForActionItem({
      ...baseItem,
      linkedRequirementTicketIds: ['REQ-001'],
    })
    expect(patch.establishedAction).toBeUndefined()
    expect(patch.manualReviewOptimization).toBeUndefined()
    expect(patch.actionSchedule).toBeUndefined()
    expect(patch.establishedActionDetail).toBe('补充说明')
  })
})
