import { describe, expect, it } from 'vitest'
import {
  ACTION_ITEM_LIST_HEADERS,
  ACTION_ITEM_STATS_HEADERS,
  buildActionItemListRows,
  buildActionItemStatsRows,
} from './actionItemExport.js'

describe('actionItemExport', () => {
  const sampleItems = [
    {
      id: 'a1',
      productKey: 'vpc',
      productName: 'VPC',
      content: '优化控制台',
      status: 'in_progress',
      firstProposedAt: '2026-05-01',
      scheduleAt: '2026-08-01',
      painPointSnapshot: '找不到入口',
      problemTypeSnapshot: '产品功能',
      journeyL1Snapshot: '使用',
      linkedTicketIds: ['T-001', 'T-002'],
      linkedDataSources: ['complaint_ticket'],
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-01T00:00:00.000Z',
    },
    {
      id: 'a2',
      productKey: 'eip',
      productName: 'EIP',
      content: '文档补充',
      status: 'pending_evaluation',
      firstProposedAt: '2026-05-02',
      scheduleAt: '',
      painPointSnapshot: '文档缺失',
      problemTypeSnapshot: '文档自助',
      journeyL1Snapshot: '了解',
      linkedTicketIds: ['T-003'],
      linkedDataSources: ['consultation_ticket'],
      createdAt: '2026-05-02T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
    },
  ]

  it('buildActionItemStatsRows includes status columns and summary row', () => {
    const rows = buildActionItemStatsRows([
      {
        productKey: 'vpc',
        productName: 'VPC',
        counts: { pending_evaluation: 0, in_progress: 1, completed: 0, suspended: 0 },
        total: 1,
      },
      {
        productKey: 'eip',
        productName: 'EIP',
        counts: { pending_evaluation: 1, in_progress: 0, completed: 0, suspended: 0 },
        total: 1,
      },
    ])
    expect(Object.keys(rows[0])).toEqual(ACTION_ITEM_STATS_HEADERS)
    expect(rows.at(-1)).toMatchObject({
      产品名称: '合计',
      待评估: 1,
      进行中: 1,
      合计: 2,
    })
  })

  it('buildActionItemListRows maps table columns and filters linked tickets by period', () => {
    const periodSet = new Set(['T-001'])
    const rows = buildActionItemListRows(sampleItems, periodSet)
    expect(Object.keys(rows[0])).toEqual(ACTION_ITEM_LIST_HEADERS)
    expect(rows[0]['关联工单(本周期)']).toBe('T-001')
    expect(rows[0].来源).toBe('投诉工单')
    expect(rows[0].状态).toBe('进行中')
    expect(rows[1]['关联工单(本周期)']).toBe('')
    expect(rows[1].状态).toBe('待评估')
  })

  it('buildActionItemListRows without period filter exports all linked tickets', () => {
    const rows = buildActionItemListRows(sampleItems, null)
    expect(rows[0]['关联工单(本周期)']).toBe('T-001\nT-002')
  })
})
