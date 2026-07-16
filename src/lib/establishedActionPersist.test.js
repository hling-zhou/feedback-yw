import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/actionItemClient.js', () => ({
  createActionItem: vi.fn(),
  getActionItem: vi.fn(),
  updateActionItem: vi.fn(),
  unlinkTicketsFromActionLibrary: vi.fn(),
}))

vi.mock('./actionItemTicketSync.js', () => ({
  syncLinkedTicketCopies: vi.fn(),
}))

import {
  createActionItem,
  getActionItem,
  updateActionItem,
  unlinkTicketsFromActionLibrary,
} from '../lib/actionItemClient.js'
import { syncLinkedTicketCopies } from './actionItemTicketSync.js'
import {
  mergeEstablishedActionLibraryForRecords,
  persistEstablishedActionForTicket,
  syncLinkedTicketsForActionIds,
} from './establishedActionPersist.js'

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
        detail: '',
        status: 'pending_evaluation',
        painPointSnapshot: '痛点',
        problemTypeSnapshot: '故障',
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

  it('manual retry uses form actionId when record.actionId is still empty', async () => {
    getActionItem.mockResolvedValue({
      id: 'act-partial',
      content: '已创建未回写',
      status: 'pending_evaluation',
      scheduleAt: '',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })
    updateActionItem.mockResolvedValue({
      id: 'act-partial',
      content: '重试更新',
      status: 'pending_evaluation',
      scheduleAt: '',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-02T00:00:00.000Z',
    })

    const patch = await persistEstablishedActionForTicket(record, {
      content: '重试更新',
      scheduleAt: '',
      actionId: 'act-partial',
      linkedFromLibrary: false,
    })

    expect(createActionItem).not.toHaveBeenCalled()
    expect(updateActionItem).toHaveBeenCalledWith(
      'act-partial',
      expect.objectContaining({ content: '重试更新' }),
      { skipConflictCheck: true },
    )
    expect(patch.actionId).toBe('act-partial')
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

  it('mergeEstablishedActionLibraryForRecords upserts each import row', async () => {
    createActionItem.mockResolvedValue({
      id: 'act-import',
      content: '导入举措',
      status: 'pending_evaluation',
      scheduleAt: '',
      linkedTicketIds: ['T-100'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })

    const merged = await mergeEstablishedActionLibraryForRecords([
      { ...record, establishedAction: '导入举措', actionSchedule: '' },
    ])

    expect(merged).toHaveLength(1)
    expect(merged[0].actionId).toBe('act-import')
    expect(merged[0].establishedAction).toBe('导入举措')
    expect(createActionItem).toHaveBeenCalled()
  })

  it('syncLinkedTicketsForActionIds delegates to syncLinkedTicketCopies', async () => {
    getActionItem.mockResolvedValue({
      id: 'act-shared',
      content: '共享举措',
      scheduleAt: '2026-09-01',
    })
    syncLinkedTicketCopies.mockResolvedValue(2)
    const updateFeedback = vi.fn()

    const total = await syncLinkedTicketsForActionIds(
      ['act-shared'],
      [{ id: 'r1', actionId: 'act-shared' }],
      updateFeedback,
    )

    expect(total).toBe(2)
    expect(syncLinkedTicketCopies).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'act-shared' }),
      [{ id: 'r1', actionId: 'act-shared' }],
      updateFeedback,
    )
  })
})
