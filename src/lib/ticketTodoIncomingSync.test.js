import { describe, expect, it, vi } from 'vitest'
import { getTicketTodoDraftItems, normalizeTicketTodoIncoming } from '../domain/ticketTodo.js'
import {
  mergeTicketTodoIncomingFromHost,
  persistTicketTodoLinkChange,
  syncTicketTodoIncoming,
} from './ticketTodoIncomingSync.js'

function hostRecord(overrides = {}) {
  return {
    id: 'rec-host',
    ticketId: 'C-1',
    dataSourceType: 'complaint_ticket',
    ticketTodo: {
      items: [
        {
          id: 'td-1',
          text: '复盘跟进',
          resolution: 'open',
          assignees: [{ userId: 'u1', username: '张三' }],
          linkedTicketIds: ['C-1'],
        },
      ],
    },
    ...overrides,
  }
}

function linkedRecord(overrides = {}) {
  return {
    id: 'rec-linked',
    ticketId: 'C-2',
    dataSourceType: 'complaint_ticket',
    ticketTodoIncoming: [],
    ...overrides,
  }
}

describe('ticketTodoIncomingSync', () => {
  it('writes incoming onto linked tickets and clears it after unlink', async () => {
    const host = hostRecord()
    const linked = linkedRecord()
    /** @type {Record<string, object>} */
    const store = { [host.id]: host, [linked.id]: linked }
    const updateFeedback = vi.fn(async (id, patch) => {
      store[id] = { ...store[id], ...patch }
      return store[id]
    })

    const previousItems = getTicketTodoDraftItems(host)
    const nextItems = previousItems.map((item) => ({
      ...item,
      linkedTicketIds: ['C-1', 'C-2'],
    }))

    await syncTicketTodoIncoming({
      hostRecord: { ...host, ticketTodo: { items: nextItems } },
      previousItems,
      nextItems,
      feedbacks: [host, linked],
      updateFeedback,
    })

    const incoming = normalizeTicketTodoIncoming(store[linked.id].ticketTodoIncoming)
    expect(incoming).toEqual([
      expect.objectContaining({
        hostRecordId: 'rec-host',
        hostTicketId: 'C-1',
        itemId: 'td-1',
        text: '复盘跟进',
      }),
    ])

    await syncTicketTodoIncoming({
      hostRecord: host,
      previousItems: nextItems,
      nextItems: previousItems,
      feedbacks: [host, store[linked.id]],
      updateFeedback,
    })
    expect(normalizeTicketTodoIncoming(store[linked.id].ticketTodoIncoming)).toEqual([])
  })

  it('persistTicketTodoLinkChange updates host linkedTicketIds and linked incoming', async () => {
    const host = hostRecord()
    const linked = linkedRecord()
    /** @type {Record<string, object>} */
    const store = { [host.id]: host, [linked.id]: linked }
    const updateFeedback = vi.fn(async (id, patch) => {
      store[id] = { ...store[id], ...patch }
      return store[id]
    })

    await persistTicketTodoLinkChange({
      hostRecord: host,
      itemId: 'td-1',
      ticketId: 'C-2',
      mode: 'link',
      actor: { userId: 'u9', username: '编辑' },
      feedbacks: [host, linked],
      updateFeedback,
    })

    expect(store[host.id].ticketTodo.items[0].linkedTicketIds).toEqual(['C-1', 'C-2'])
    expect(store[linked.id].ticketTodoIncoming[0].itemId).toBe('td-1')

    await persistTicketTodoLinkChange({
      hostRecord: store[host.id],
      itemId: 'td-1',
      ticketId: 'C-2',
      mode: 'unlink',
      actor: { userId: 'u9', username: '编辑' },
      feedbacks: [store[host.id], store[linked.id]],
      updateFeedback,
    })
    expect(store[host.id].ticketTodo.items[0].linkedTicketIds).toEqual(['C-1'])
    expect(normalizeTicketTodoIncoming(store[linked.id].ticketTodoIncoming)).toEqual([])
  })

  it('mergeTicketTodoIncomingFromHost keeps refs from other hosts', () => {
    const record = linkedRecord({
      ticketTodoIncoming: [
        {
          hostRecordId: 'other',
          hostTicketId: 'C-9',
          itemId: 'x',
          text: '另一条',
          resolution: 'open',
          assignees: [],
          linkedTicketIds: ['C-9', 'C-2'],
        },
      ],
    })
    const merged = mergeTicketTodoIncomingFromHost(record, 'rec-host', [
      {
        hostRecordId: 'rec-host',
        hostTicketId: 'C-1',
        itemId: 'td-1',
        text: '复盘跟进',
        resolution: 'open',
        assignees: [],
        linkedTicketIds: ['C-1', 'C-2'],
      },
    ])
    expect(merged.map((row) => row.hostRecordId).sort()).toEqual(['other', 'rec-host'])
  })
})
