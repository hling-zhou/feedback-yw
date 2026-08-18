import { describe, expect, it } from 'vitest'
import { TICKET_TODO_UNASSIGNED_ASSIGNEE } from '../domain/ticketTodo.js'
import {
  buildTicketTodoAssigneeFilterOptions,
  createEmptyTicketTodoFilters,
  ticketTodoFiltersToListQuery,
} from './ticketTodoFilterModel.js'

describe('ticketTodoFilterModel', () => {
  it('serializes filters including unassigned assignee', () => {
    const values = {
      ...createEmptyTicketTodoFilters(),
      productKeys: ['vpc'],
      statuses: ['open'],
      dataSourceTypes: ['complaint_ticket'],
      assigneeUserIds: [TICKET_TODO_UNASSIGNED_ASSIGNEE, 'u1'],
      ticketId: 'C-1',
    }
    expect(ticketTodoFiltersToListQuery(values)).toEqual({
      productKeys: 'vpc',
      statuses: 'open',
      dataSourceTypes: 'complaint_ticket',
      assigneeUserIds: `${TICKET_TODO_UNASSIGNED_ASSIGNEE},u1`,
      ticketId: 'C-1',
    })
  })

  it('builds assignee options with 未指定 first', () => {
    const options = buildTicketTodoAssigneeFilterOptions([
      { assigneeUserId: '', assigneeUsername: '' },
      { assigneeUserId: 'u2', assigneeUsername: '乙' },
      { assigneeUserId: 'u1', assigneeUsername: '甲' },
    ])
    expect(options[0]).toEqual({ value: TICKET_TODO_UNASSIGNED_ASSIGNEE, label: '未指定' })
    expect(options.map((item) => item.value)).toEqual([TICKET_TODO_UNASSIGNED_ASSIGNEE, 'u1', 'u2'])
  })
})
