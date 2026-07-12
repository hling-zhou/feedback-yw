import { describe, expect, it } from 'vitest'
import {
  buildTicketTodoSavePatch,
  createEmptyTicketTodoItem,
  getOpenTicketTodoSummary,
  hasOpenTicketTodos,
  hasOpenTicketTodosAssignedTo,
  normalizeTicketTodoInput,
  ticketTodoItemsEqual,
} from './ticketTodo.js'
import { matchesTodoStatusFilter } from '../lib/feedbackFilters.js'

describe('ticketTodo', () => {
  it('normalizes assignee and detects open todos', () => {
    const items = normalizeTicketTodoInput([
      {
        id: 'a',
        text: ' 跟进厂商 ',
        done: false,
        assigneeUserId: 'u1',
        assigneeUsername: '张三',
        updatedAt: '2026-07-12T10:00:00.000Z',
        updatedBy: { userId: 'u2', username: '李四' },
      },
      { id: 'b', text: '已完成', done: true, assigneeUserId: 'u1', assigneeUsername: '张三' },
      { id: 'c', text: '   ', done: false },
    ])
    expect(items).toHaveLength(2)
    expect(items[0].assigneeUsername).toBe('张三')
    expect(items[0].updatedBy?.username).toBe('李四')
    expect(hasOpenTicketTodos({ ticketTodo: { items } })).toBe(true)
    expect(hasOpenTicketTodosAssignedTo({ ticketTodo: { items } }, 'u1')).toBe(true)
    expect(hasOpenTicketTodosAssignedTo({ ticketTodo: { items } }, 'u9')).toBe(false)
    expect(getOpenTicketTodoSummary({ ticketTodo: { items } })).toBe('张三：跟进厂商')
  })

  it('builds save patch only when items change and stamps per-item edit metadata', () => {
    const record = {
      ticketTodo: {
        items: [
          {
            id: 'a',
            text: '旧待办',
            done: false,
            assigneeUserId: 'u1',
            assigneeUsername: '张三',
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedBy: { userId: 'u1', username: '张三' },
          },
        ],
        updatedAt: '2026-01-01T00:00:00.000Z',
        updatedBy: { userId: 'u1', username: '张三' },
      },
    }
    expect(
      buildTicketTodoSavePatch(
        record,
        [
          {
            id: 'a',
            text: '旧待办',
            done: false,
            assigneeUserId: 'u1',
            assigneeUsername: '张三',
          },
        ],
        { userId: 'u2', username: '李四' },
      ),
    ).toEqual({})

    const patch = buildTicketTodoSavePatch(
      record,
      [
        {
          id: 'a',
          text: '新待办',
          done: false,
          assigneeUserId: 'u3',
          assigneeUsername: '王五',
        },
      ],
      { userId: 'u2', username: '李四' },
    )
    expect(patch.ticketTodo?.items[0]).toMatchObject({
      id: 'a',
      text: '新待办',
      assigneeUserId: 'u3',
      assigneeUsername: '王五',
      updatedBy: { userId: 'u2', username: '李四' },
    })
    expect(patch.ticketTodo?.items[0].updatedAt).toMatch(/^\d{4}-/)
  })

  it('compares todo item lists including assignee', () => {
    const left = [{ id: '1', text: 'A', done: false, assigneeUserId: 'u1' }]
    const right = [{ id: '1', text: 'A', done: false, assigneeUserId: 'u2' }]
    expect(ticketTodoItemsEqual(left, left)).toBe(true)
    expect(ticketTodoItemsEqual(left, right)).toBe(false)
    expect(createEmptyTicketTodoItem()).toMatchObject({
      assigneeUserId: '',
      assigneeUsername: '',
    })
  })

  it('matches my_open todo filter for current user only', () => {
    const record = {
      ticketTodo: {
        items: [
          { id: 'a', text: '我的', done: false, assigneeUserId: 'me' },
          { id: 'b', text: '别人的', done: false, assigneeUserId: 'other' },
        ],
      },
    }
    expect(matchesTodoStatusFilter(record, 'my_open', { userId: 'me' })).toBe(true)
    expect(matchesTodoStatusFilter(record, 'my_open', { userId: 'other' })).toBe(true)
    expect(matchesTodoStatusFilter(record, 'my_open', { userId: 'nobody' })).toBe(false)
    expect(matchesTodoStatusFilter(record, 'has_open', { userId: 'me' })).toBe(true)
  })
})
