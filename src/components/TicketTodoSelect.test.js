import { describe, expect, it } from 'vitest'
import { isTicketTodoSelectableForRecord } from './TicketTodoSelect.jsx'

describe('isTicketTodoSelectableForRecord', () => {
  const open = {
    id: 'r1::t1',
    recordId: 'r1',
    ticketId: 'C-1',
    ticketTodoItemId: 't1',
    text: '复盘',
    resolution: 'open',
    linkedTicketIds: ['C-1'],
  }

  it('excludes closed, own-host, and already-linked todos', () => {
    expect(isTicketTodoSelectableForRecord(open, 'C-9', 'r9')).toBe(true)
    expect(isTicketTodoSelectableForRecord({ ...open, resolution: 'converted_to_action' }, 'C-9', 'r9')).toBe(
      false,
    )
    expect(isTicketTodoSelectableForRecord(open, 'C-9', 'r1')).toBe(false)
    expect(isTicketTodoSelectableForRecord({ ...open, linkedTicketIds: ['C-1', 'C-9'] }, 'C-9', 'r9')).toBe(
      false,
    )
  })
})
