import { describe, expect, it } from 'vitest'
import {
  applyTicketTodoResolutionToItem,
  buildTicketTodoSavePatch,
  computeSharePercent,
  createEmptyTicketTodoItem,
  flattenTicketTodosFromRecord,
  collectTicketTodoFacets,
  getOpenTicketTodoSummary,
  getTicketTodoResolution,
  hasOpenTicketTodos,
  hasOpenTicketTodosAssignedTo,
  lockTicketTodoResolution,
  markOpenTicketTodosConvertedWhenEstablishingAction,
  normalizeTicketTodoInput,
  resolveTicketTodoProcessResolution,
  shouldPersistEstablishedActionOnProcess,
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
    expect(items[0].resolution).toBe('open')
    expect(items[1].resolution).toBe('processed_without_action')
    expect(items[1].done).toBe(true)
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

  it('infers resolution from legacy done and stamps createdAt on first save', () => {
    expect(getTicketTodoResolution({ text: 'x', done: true })).toBe('processed_without_action')
    expect(getTicketTodoResolution({ text: 'x', done: false })).toBe('open')
    expect(getTicketTodoResolution({ text: 'x', resolution: 'converted_to_action', done: false })).toBe(
      'converted_to_action',
    )

    const record = { ticketTodo: { items: [] } }
    const patch = buildTicketTodoSavePatch(
      record,
      [{ id: 'n1', text: '新待办', done: false, assigneeUserId: '', assigneeUsername: '' }],
      { userId: 'u1', username: '甲' },
    )
    expect(patch.ticketTodo?.items[0]).toMatchObject({
      resolution: 'open',
      done: false,
    })
    expect(patch.ticketTodo?.items[0].createdAt).toMatch(/^\d{4}-/)
  })

  it('locks terminal resolution and maps process submit branches', () => {
    expect(lockTicketTodoResolution('converted_to_action', 'open')).toBe('converted_to_action')
    expect(lockTicketTodoResolution('processed_without_action', 'open')).toBe(
      'processed_without_action',
    )
    expect(lockTicketTodoResolution('open', 'processed_without_action')).toBe(
      'processed_without_action',
    )

    expect(
      resolveTicketTodoProcessResolution({
        establishedActionContent: '优化控制台',
        markProcessed: true,
      }),
    ).toBe('converted_to_action')
    expect(
      resolveTicketTodoProcessResolution({
        actionId: 'act-1',
        linkedFromLibrary: true,
        markProcessed: false,
      }),
    ).toBe('converted_to_action')
    expect(
      resolveTicketTodoProcessResolution({
        establishedActionContent: '',
        markProcessed: true,
      }),
    ).toBe('processed_without_action')
    expect(
      resolveTicketTodoProcessResolution({
        establishedActionContent: '',
        markProcessed: false,
      }),
    ).toBe('open')
    expect(
      resolveTicketTodoProcessResolution({
        processMode: 'no_action',
        establishedActionContent: '库里残留举措',
        actionId: 'act-1',
        linkedFromLibrary: true,
        markProcessed: true,
      }),
    ).toBe('processed_without_action')
    expect(
      resolveTicketTodoProcessResolution({
        processMode: 'no_action',
        establishedActionContent: '',
        markProcessed: false,
      }),
    ).toBe('open')
    expect(
      resolveTicketTodoProcessResolution({
        processMode: 'establish_action',
        establishedActionContent: '',
        markProcessed: true,
      }),
    ).toBe('open')
    expect(
      resolveTicketTodoProcessResolution({
        processMode: 'establish_action',
        establishedActionContent: '优化控制台',
        markProcessed: false,
      }),
    ).toBe('converted_to_action')
    expect(
      resolveTicketTodoProcessResolution({
        processMode: 'establish_action',
        actionId: 'act-1',
        establishedActionContent: '',
        linkedFromLibrary: false,
        markProcessed: false,
      }),
    ).toBe('open')
    expect(
      resolveTicketTodoProcessResolution({
        establishedActionContent: '',
        actionId: 'act-1',
        markProcessed: false,
      }),
    ).toBe('open')
    expect(shouldPersistEstablishedActionOnProcess('converted_to_action')).toBe(true)
    expect(shouldPersistEstablishedActionOnProcess('processed_without_action')).toBe(false)

    const convertedOpen = markOpenTicketTodosConvertedWhenEstablishingAction(
      [
        { id: 'a', text: '跟进', done: false, resolution: 'open' },
        {
          id: 'b',
          text: '已闭环',
          done: true,
          resolution: 'processed_without_action',
        },
      ],
      { hadAction: false, nowHasAction: true, linkedActionId: 'act-9' },
    )
    expect(convertedOpen[0]).toMatchObject({
      resolution: 'converted_to_action',
      linkedActionId: 'act-9',
    })
    expect(convertedOpen[1].resolution).toBe('processed_without_action')
    expect(
      markOpenTicketTodosConvertedWhenEstablishingAction(
        [{ id: 'a', text: '跟进', done: false, resolution: 'open' }],
        { hadAction: true, nowHasAction: true },
      )[0].resolution,
    ).toBe('open')

    const processed = applyTicketTodoResolutionToItem(
      { id: 'a', text: '跟进', done: false, resolution: 'open' },
      'processed_without_action',
      { processNote: '会议已闭环' },
    )
    expect(processed).toMatchObject({
      resolution: 'processed_without_action',
      done: true,
      processNote: '会议已闭环',
    })
  })

  it('does not revert converted todos when saving from feedback drawer', () => {
    const record = {
      ticketTodo: {
        items: [
          {
            id: 'a',
            text: '跟进',
            done: true,
            resolution: 'converted_to_action',
            linkedActionId: 'act-1',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            updatedBy: { userId: 'u1', username: '张三' },
          },
        ],
      },
    }
    const patch = buildTicketTodoSavePatch(
      record,
      [
        {
          id: 'a',
          text: '跟进',
          done: false,
          resolution: 'open',
          linkedActionId: 'act-1',
        },
      ],
      { userId: 'u2', username: '李四' },
    )
    expect(patch).toEqual({})
  })

  it('flattens complaint/consultation todos and skips post-use ratings', () => {
    const complaint = {
      id: 'r1',
      ticketId: 'C-1',
      dataSourceType: 'complaint_ticket',
      productKey: 'vpc',
      product: 'VPC',
      painPoint: '控制台卡顿',
      ticketTodo: {
        items: [{ id: 't1', text: '复盘跟进', done: false }],
      },
    }
    const rating = {
      id: 'r2',
      ticketId: 'P-1',
      dataSourceType: 'post_use_rating',
      ticketTodo: {
        items: [{ id: 't2', text: '不该出现', done: false }],
      },
    }
    expect(flattenTicketTodosFromRecord(complaint)).toEqual([
      expect.objectContaining({
        id: 'r1::t1',
        ticketId: 'C-1',
        resolution: 'open',
        painPoint: '控制台卡顿',
        productName: 'VPC',
      }),
    ])
    expect(flattenTicketTodosFromRecord(rating)).toEqual([])
    expect(computeSharePercent(1, 4)).toBe(25)
    expect(computeSharePercent(0, 0)).toBe(0)
  })

  it('collects product and assignee facets from all rows including unassigned', () => {
    const facets = collectTicketTodoFacets([
      { productKey: 'vpc', productName: '虚拟私有云', assigneeUserId: 'u1', assigneeUsername: '张三' },
      { productKey: 'vpc', productName: '虚拟私有云', assigneeUserId: '', assigneeUsername: '' },
      { productKey: 'eip', productName: '弹性公网IP', assigneeUserId: 'u2', assigneeUsername: '李四' },
    ])
    expect(facets.products.map((item) => item.productKey).sort()).toEqual(['eip', 'vpc'])
    expect(facets.assignees).toEqual(
      expect.arrayContaining([
        { userId: 'u1', username: '张三' },
        { userId: 'u2', username: '李四' },
      ]),
    )
    expect(facets.hasUnassigned).toBe(true)
  })
})
