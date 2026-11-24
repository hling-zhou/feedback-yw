import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  ACTION_ITEM_LIST_HEADERS,
  ACTION_ITEM_STATS_HEADERS,
  buildActionItemListRows,
  buildActionItemStatsRows,
  buildActionItemsWorkbookBySource,
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

  it('buildActionItemListRows resolves product name from catalog map', () => {
    const productNameByKey = new Map([['eip', '弹性公网IP']])
    const rows = buildActionItemListRows(
      [
        {
          ...sampleItems[1],
          productName: '弹性公网IP-移动IP',
        },
      ],
      null,
      undefined,
      productNameByKey,
    )
    expect(rows[0].产品名称).toBe('弹性公网IP')
  })

  it('buildActionItemListRows maps table columns and filters linked tickets by period', () => {
    const periodSet = new Set(['T-001'])
    const rows = buildActionItemListRows(sampleItems, periodSet)
    expect(Object.keys(rows[0])).toEqual(ACTION_ITEM_LIST_HEADERS)
    expect(rows[0]['关联反馈(本周期)']).toBe('未知月份: T-001')
    // 来源列输出档名（11-24 拍板）：无 source 默认 ticket 档；linkedDataSources 不再决定此列
    expect(rows[0].来源).toBe('投诉/咨询')
    expect(rows[0].举措详情).toBe('分阶段上线')
    expect(rows[0].需求工单).toBe('REQ-001')
    expect(rows[0].状态).toBe('进行中')
    expect(rows[0].最近更新人员).toBe('alice')
    expect(rows[0].最近更新时间).toMatch(/2026/)
    expect(rows[1]['关联反馈(本周期)']).toBe('')
    expect(rows[1].状态).toBe('待评估')
  })

  it('buildActionItemListRows 来源列输出档名（source 单值映射，往返导入可识别）', () => {
    const rows = buildActionItemListRows(
      [
        { ...sampleItems[0], source: 'post_use' },
        { ...sampleItems[1], source: 'api_patrol' },
        { ...sampleItems[1], id: 'a3', source: 'observation' },
      ],
      null,
    )
    expect(rows[0].来源).toBe('用后即评')
    expect(rows[1].来源).toBe('API巡检')
    expect(rows[2].来源).toBe('留观问题')
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

  it('buildActionItemsWorkbookBySource 按来源档分 sheet：首 sheet 全部总览，每档 统计+清单 一对，空档跳过，/ 替换为全角（11-24）', () => {
    const wb = buildActionItemsWorkbookBySource({
      items: [
        { ...sampleItems[0], source: 'ticket' },
        { ...sampleItems[1], source: 'api_patrol' },
        { ...sampleItems[1], id: 'a3', source: 'post_use' },
        // observation 无数据 → 该档不出 sheet
      ],
      periodTicketIdSet: null,
    })
    expect(wb.SheetNames).toEqual([
      '全部·分产品统计',
      '投诉／咨询·分产品统计',
      '投诉／咨询·举措清单',
      '用后即评·分产品统计',
      '用后即评·举措清单',
      'API巡检·分产品统计',
      'API巡检·举措清单',
    ])
    // 总览 sheet：跨来源聚合（合计 = 各档之和）
    const allStats = XLSX.utils.sheet_to_json(wb.Sheets['全部·分产品统计'])
    const summaryRow = allStats.find((r) => r.产品名称 === '合计')
    expect(summaryRow.合计).toBe(3)
    // 各档清单 sheet 行数与该档条数一致（无跨档混入）
    const ticketList = XLSX.utils.sheet_to_json(wb.Sheets['投诉／咨询·举措清单'])
    expect(ticketList).toHaveLength(1)
    expect(ticketList[0].来源).toBe('投诉/咨询')
    const patrolList = XLSX.utils.sheet_to_json(wb.Sheets['API巡检·举措清单'])
    expect(patrolList).toHaveLength(1)
    expect(patrolList[0].来源).toBe('API巡检')
  })

  it('buildActionItemsWorkbookBySource 全空 items 仍出总览 sheet（占位行）', () => {
    const wb = buildActionItemsWorkbookBySource({ items: [], periodTicketIdSet: null })
    expect(wb.SheetNames).toEqual(['全部·分产品统计'])
    const allStats = XLSX.utils.sheet_to_json(wb.Sheets['全部·分产品统计'])
    // buildActionItemStatsRows 空输入的既有形态：单个「—」占位行（无合计行）
    expect(allStats).toHaveLength(1)
    expect(allStats[0].产品名称).toBe('—')
    expect(allStats[0].合计).toBe(0)
  })
})
