import { describe, expect, it } from 'vitest'
import {
  actionItemMatchesJourneyL1Filter,
  actionItemMatchesProblemTypeFilter,
  buildActionItemJourneyL1FilterOptions,
  buildActionItemProblemTypeFilterOptions,
  collectJourneyL1FromItem,
  collectProblemTypesFromItem,
  resolveJourneyDisplay,
  resolveProblemTypeDisplay,
} from './actionItemDisplay.js'

const baseItem = {
  id: 'act-1',
  content: '举措',
  status: 'pending_evaluation',
  linkedTicketIds: ['T-100'],
  createdAt: '',
  updatedAt: '',
}

describe('actionItemDisplay', () => {
  const feedbackByTicketId = new Map([
    [
      'T-100',
      {
        problemType: '故障',
        journeyL1: '使用',
        journeyL2: '监控',
      },
    ],
  ])

  it('resolveProblemTypeDisplay prefers snapshot', () => {
    expect(
      resolveProblemTypeDisplay(
        { ...baseItem, problemTypeSnapshot: '计费与账单' },
        feedbackByTicketId,
      ),
    ).toBe('计费与账单')
  })

  it('resolveProblemTypeDisplay falls back to first linked ticket', () => {
    expect(resolveProblemTypeDisplay(baseItem, feedbackByTicketId)).toBe('故障')
    expect(resolveProblemTypeDisplay(baseItem, new Map())).toBe('')
  })

  it('resolveJourneyDisplay prefers snapshot', () => {
    expect(
      resolveJourneyDisplay(
        { ...baseItem, journeyL1Snapshot: '开通', journeyL2Snapshot: '订购' },
        feedbackByTicketId,
      ),
    ).toEqual({ journeyL1: '开通', journeyL2: '订购' })
  })

  it('resolveJourneyDisplay falls back to first linked ticket', () => {
    expect(resolveJourneyDisplay(baseItem, feedbackByTicketId)).toEqual({
      journeyL1: '使用',
      journeyL2: '监控',
    })
  })

  it('filter matchers require exact resolved values', () => {
    expect(actionItemMatchesProblemTypeFilter(baseItem, '故障', feedbackByTicketId)).toBe(true)
    expect(actionItemMatchesProblemTypeFilter(baseItem, '性能问题', feedbackByTicketId)).toBe(false)
    expect(actionItemMatchesJourneyL1Filter(baseItem, '使用', feedbackByTicketId)).toBe(true)
    expect(actionItemMatchesJourneyL1Filter(baseItem, '开通', feedbackByTicketId)).toBe(false)
  })

  it('buildActionItem filter options skip empty resolved values', () => {
    const items = [
      baseItem,
      { ...baseItem, id: 'act-2', problemTypeSnapshot: '文档自助', linkedTicketIds: [] },
    ]
    expect(buildActionItemProblemTypeFilterOptions(items, feedbackByTicketId)).toEqual([
      { label: '故障', value: '故障' },
      { label: '文档自助', value: '文档自助' },
    ])
    expect(buildActionItemJourneyL1FilterOptions(items, feedbackByTicketId)).toEqual([
      { label: '使用', value: '使用' },
    ])
  })
})

describe('actionItemDisplay 聚合所有关联工单（去首单化）', () => {
  // 举措关联 3 个工单：首单=计费，另有 2 个=故障
  const multiFeedback = new Map([
    ['T-1', { problemType: '计费与账单', journeyL1: '使用', journeyL2: '监控' }],
    ['T-2', { problemType: '可用性/连通性故障', journeyL1: '使用', journeyL2: '连接' }],
    ['T-3', { problemType: '可用性/连通性故障', journeyL1: '开通', journeyL2: '配置' }],
  ])
  const multiItem = {
    ...baseItem,
    id: 'act-multi',
    linkedTicketIds: ['T-1', 'T-2', 'T-3'],
    problemTypeSnapshot: '计费与账单', // 首单快照
  }

  it('collectProblemTypesFromItem 聚合所有关联工单的问题类型（去重）', () => {
    expect(collectProblemTypesFromItem(multiItem, multiFeedback).sort()).toEqual([
      '可用性/连通性故障',
      '计费与账单',
    ])
    expect(collectJourneyL1FromItem(multiItem, multiFeedback).sort()).toEqual(['使用', '开通'])
  })

  it('按"故障"筛不漏掉首单是计费、但关联了故障工单的举措', () => {
    expect(actionItemMatchesProblemTypeFilter(multiItem, '可用性/连通性故障', multiFeedback)).toBe(true)
    expect(actionItemMatchesProblemTypeFilter(multiItem, '计费与账单', multiFeedback)).toBe(true)
    expect(actionItemMatchesProblemTypeFilter(multiItem, '性能问题', multiFeedback)).toBe(false)
    expect(actionItemMatchesJourneyL1Filter(multiItem, '开通', multiFeedback)).toBe(true)
  })

  it('filter options 含全部关联工单的类型', () => {
    const options = buildActionItemProblemTypeFilterOptions([multiItem], multiFeedback)
    expect(options.map((o) => o.value).sort()).toEqual(['可用性/连通性故障', '计费与账单'])
  })
})
