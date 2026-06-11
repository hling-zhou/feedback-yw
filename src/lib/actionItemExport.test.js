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
      detail: '分阶段上线',
      status: 'in_progress',
      firstProposedAt: '2026-05-01',
      scheduleAt: '2026-08-01',
      painPointSnapshot: '找不到入口',
      problemTypeSnapshot: '产品功能',
      journeyL1Snapshot: '使用',
      linkedTicketIds: ['T-001', 'T-002'],
      linkedRequirementTicketIds: ['REQ-001'],
      requirementLinkMode: true,
      derivedScheduleAt: '2026-08-01',
      derivedStatus: 'in_progress',
      linkedDataSources: ['complaint_ticket'],
      updatedAt: '2026-05-01T10:00:00.000Z',
      updatedBy: { userId: 'u1', username: 'alice' },
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
        linkedFeedbackCounts: { pending_evaluation: 0, in_progress: 2, completed: 0, suspended: 0 },
        total: 1,
        linkedFeedbackTotal: 2,
      },
      {
        productKey: 'eip',
        productName: 'EIP',
        counts: { pending_evaluation: 1, in_progress: 0, completed: 0, suspended: 0 },
        linkedFeedbackCounts: { pending_evaluation: 1, in_progress: 0, completed: 0, suspended: 0 },
        total: 1,
        linkedFeedbackTotal: 1,
      },
    ])
    expect(Object.keys(rows[0])).toEqual(ACTION_ITEM_STATS_HEADERS)
    expect(rows.at(-1)).toMatchObject({
      产品名称: '合计',
      待评估: 1,
      进行中: 1,
      '进行中(关联反馈)': 2,
      合计: 2,
      关联反馈合计: 3,
    })
  })

  it('buildActionItemListRows maps table columns and filters linked tickets by period', () => {
    const periodSet = new Set(['T-001'])
    const rows = buildActionItemListRows(sampleItems, periodSet)
    expect(Object.keys(rows[0])).toEqual(ACTION_ITEM_LIST_HEADERS)
    expect(rows[0]['关联反馈(本周期)']).toBe('未知月份: T-001')
    expect(rows[0].来源).toBe('投诉工单')
    expect(rows[0].举措详情).toBe('分阶段上线')
    expect(rows[0].需求工单).toBe('REQ-001')
    expect(rows[0].状态).toBe('进行中')
    expect(rows[0].最近更新人员).toBe('alice')
    expect(rows[0].最近更新时间).toMatch(/2026/)
    expect(rows[1]['关联反馈(本周期)']).toBe('')
    expect(rows[1].状态).toBe('待评估')
  })

  it('buildActionItemListRows without period filter exports all linked tickets', () => {
    const rows = buildActionItemListRows(sampleItems, null)
    expect(rows[0]['关联反馈(本周期)']).toBe('未知月份: T-001; T-002')
  })

  it('buildActionItemListRows exports derived schedule and status for requirement-linked items', () => {
    const rows = buildActionItemListRows(
      [
        {
          ...sampleItems[0],
          requirementLinkMode: true,
          derivedScheduleAt: '2026-09-15',
          derivedStatus: 'in_progress',
          scheduleAt: '2026-08-01',
          status: 'pending_evaluation',
        },
      ],
      null,
    )
    expect(rows[0].排期时间).toBe('2026-09-15')
    expect(rows[0].状态).toBe('进行中')
    expect(rows[0].举措).toBe('优化控制台')
  })

  it('buildActionItemListRows exports 待同步 when requirement-linked without derived status', () => {
    const rows = buildActionItemListRows(
      [
        {
          ...sampleItems[0],
          requirementLinkMode: true,
          linkedRequirementTicketIds: ['REQ-001'],
          derivedStatus: undefined,
        },
      ],
      null,
    )
    expect(rows[0].状态).toBe('待同步')
  })
})
