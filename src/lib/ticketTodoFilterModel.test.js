import { describe, expect, it } from 'vitest'
import { TICKET_TODO_UNASSIGNED_ASSIGNEE } from '../domain/ticketTodo.js'
import {
  buildTicketTodoAssigneeFilterOptions,
  buildTicketTodoProductFilterOptions,
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

  it('excludes out-of-analysis-scope products when catalog provided (11-24: 范围外产品不进复合搜索)', () => {
    // 会议待办行数据可能含范围外产品（本地实锤：elb 负载均衡 74 条工单）——
    // 传目录时按 enabled || analysisPostUseRating 收窄，与产品举措同判据
    /** @type {import('./productCatalogLoader.js').CatalogProduct[]} */
    const catalog = [
      { key: 'eip', name: '弹性公网IP', enabled: true, analysisPostUseRating: true, taxonomyKey: 'eip', specs: [] },
      { key: 'elb', name: '负载均衡', enabled: false, analysisPostUseRating: false, taxonomyKey: 'elb', specs: [] },
      { key: 'shared_bw', name: '共享带宽', enabled: false, analysisPostUseRating: true, taxonomyKey: 'shared_bw', specs: [] },
    ]
    /** @type {Partial<import('../domain/ticketTodo.js').TicketTodoRow>[]} */
    const rows = [
      { productKey: 'eip', productName: '弹性公网IP' },
      { productKey: 'elb', productName: '负载均衡' },
      { productKey: 'shared_bw', productName: '共享带宽' },
      { productKey: '', productName: '未标注' }, // _unknown 兜底键保留
    ]
    const options = buildTicketTodoProductFilterOptions(
      /** @type {any} */ (rows),
      catalog,
    )
    const keys = options.map((item) => item.value)
    expect(keys).toContain('eip')
    expect(keys).toContain('shared_bw')
    expect(keys).toContain('_unknown')
    expect(keys).not.toContain('elb')
  })

  it('falls back to all facets when catalog not provided (legacy behavior)', () => {
    /** @type {Partial<import('../domain/ticketTodo.js').TicketTodoRow>[]} */
    const rows = [{ productKey: 'elb', productName: '负载均衡' }]
    const options = buildTicketTodoProductFilterOptions(/** @type {any} */ (rows))
    expect(options).toEqual([{ value: 'elb', label: '负载均衡' }])
  })
})
