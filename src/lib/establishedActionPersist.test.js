import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/actionItemClient.js', () => ({
  createActionItem: vi.fn(),
  getActionItem: vi.fn(),
  updateActionItem: vi.fn(),
  unlinkTicketsFromActionLibrary: vi.fn(),
}))

import {
  createActionItem,
  getActionItem,
  updateActionItem,
  unlinkTicketsFromActionLibrary,
} from '../lib/actionItemClient.js'
import { persistEstablishedActionForTicket } from './establishedActionPersist.js'

describe('establishedActionPersist', () => {
  const record = {
    id: 'r1',
    ticketId: 'T-100',
    dataSourceType: 'complaint_ticket',
    productKey: 'vpc',
    productSpec: '虚拟私有云',
    problemType: '故障',
    journeyL1: '使用',
    painPoint: '痛点',
  }

  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('linkedFromLibrary returns library text copy and schedule (P4-2)', async () => {
    getActionItem.mockResolvedValue({
      id: 'act-lib',
      content: '库内举措文本',
      status: 'in_progress',
      scheduleAt: '2026-08-15',
      linkedTicketIds: [],
      linkedDataSources: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    updateActionItem.mockResolvedValue({
      id: 'act-lib',
      content: '库内举措文本',
      status: 'in_progress',
      scheduleAt: '2026-08-15',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    const patch = await persistEstablishedActionForTicket(record, {
      content: 'ignored local',
      scheduleAt: 'local-schedule',
      actionId: 'act-lib',
      linkedFromLibrary: true,
    })

    expect(patch.actionId).toBe('act-lib')
    expect(patch.establishedAction).toBe('库内举措文本')
    expect(patch.actionSchedule).toBe('2026-08-15')
    expect(updateActionItem).toHaveBeenCalledWith(
      'act-lib',
      expect.objectContaining({
        linkedTicketIds: ['T-100'],
        linkedDataSources: ['complaint_ticket'],
      }),
      { skipConflictCheck: true },
    )
  })

  it('manual input creates action item with snapshots (P4-3)', async () => {
    createActionItem.mockResolvedValue({
      id: 'act-new',
      content: '新举措',
      status: 'pending_evaluation',
      scheduleAt: '',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const patch = await persistEstablishedActionForTicket(record, {
      content: '新举措',
      scheduleAt: '',
      linkedFromLibrary: false,
    })

    expect(createActionItem).toHaveBeenCalledWith(
      expect.objectContaining({
        content: '新举措',
        status: 'pending_evaluation',
        painPointSnapshot: '痛点',
        problemTypeSnapshot: '故障',
        journeyL1Snapshot: '使用',
        linkedTicketIds: ['T-100'],
      }),
    )
    expect(patch.actionId).toBe('act-new')
    expect(patch.establishedAction).toBe('新举措')
  })

  it('manual input updates existing actionId when present', async () => {
    getActionItem.mockResolvedValue({
      id: 'act-old',
      content: '旧举措',
      status: 'in_progress',
      scheduleAt: '2026-07-01',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    updateActionItem.mockResolvedValue({
      id: 'act-old',
      content: '更新举措',
      status: 'in_progress',
      scheduleAt: '2026-09-01',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    const patch = await persistEstablishedActionForTicket(
      { ...record, actionId: 'act-old' },
      {
        content: '更新举措',
        scheduleAt: '2026-09-01',
        linkedFromLibrary: false,
      },
    )

    expect(updateActionItem).toHaveBeenCalledWith(
      'act-old',
      expect.objectContaining({
        content: '更新举措',
        scheduleAt: '2026-09-01',
        status: 'in_progress',
      }),
      { skipConflictCheck: true },
    )
    expect(patch.actionId).toBe('act-old')
  })

  it('empty content clears established action fields and unlinks action library', async () => {
    unlinkTicketsFromActionLibrary.mockResolvedValue({ updated: 1, items: [] })

    const patch = await persistEstablishedActionForTicket(
      { ...record, actionId: 'act-old' },
      {
        content: '  ',
        scheduleAt: '',
        linkedFromLibrary: false,
      },
    )

    expect(unlinkTicketsFromActionLibrary).toHaveBeenCalledWith([
      { actionId: 'act-old', ticketId: 'T-100' },
    ])
    expect(patch.actionId).toBe('')
    expect(patch.establishedAction).toBe('')
    expect(createActionItem).not.toHaveBeenCalled()
  })

  it('switching library action unlinks ticket from previous action', async () => {
    getActionItem.mockResolvedValue({
      id: 'act-new',
      content: '新库举措',
      status: 'pending_evaluation',
      scheduleAt: '',
      linkedTicketIds: [],
      linkedDataSources: [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    updateActionItem.mockResolvedValue({
      id: 'act-new',
      content: '新库举措',
      status: 'pending_evaluation',
      scheduleAt: '',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })
    unlinkTicketsFromActionLibrary.mockResolvedValue({ updated: 1, items: [] })

    await persistEstablishedActionForTicket(
      { ...record, actionId: 'act-old' },
      {
        content: '新库举措',
        scheduleAt: '',
        actionId: 'act-new',
        linkedFromLibrary: true,
      },
    )

    expect(unlinkTicketsFromActionLibrary).toHaveBeenCalledWith([
      { actionId: 'act-old', ticketId: 'T-100' },
    ])
  })
})
