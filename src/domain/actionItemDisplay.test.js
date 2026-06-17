import { describe, expect, it } from 'vitest'
import {
  actionItemMatchesJourneyL1Filter,
  actionItemMatchesProblemTypeFilter,
  buildActionItemJourneyL1FilterOptions,
  buildActionItemProblemTypeFilterOptions,
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
