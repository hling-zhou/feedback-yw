import { describe, expect, it } from 'vitest'
import {
  countActiveFeedbackFilters,
  createEmptyFeedbackFilters,
  formatFeedbackFilterChipLabel,
  getFeedbackFilterAddDisabledReason,
  isFeedbackFilterActive,
  listActiveFeedbackFilterChipKeys,
} from './feedbackFilterModel.js'
import { EMPTY_FILTER_TOKEN } from './feedbackFilters.js'

describe('feedbackFilterModel', () => {
  it('lists active chip keys and formats labels', () => {
    const values = {
      ...createEmptyFeedbackFilters(),
      product: '云主机',
      ticketIds: ['A', 'B'],
      ticketDateFrom: '2026-05-01',
      ticketDateTo: '2026-05-31',
      followUp: 'non10',
      problemType: EMPTY_FILTER_TOKEN,
    }
    expect(listActiveFeedbackFilterChipKeys(values)).toEqual([
      'ticketIds',
      'ticketDateFrom',
      'problemType',
      'followUp',
    ])
    expect(countActiveFeedbackFilters(values)).toBe(4)
    expect(formatFeedbackFilterChipLabel('ticketIds', values)).toBe('2 个')
    expect(formatFeedbackFilterChipLabel('ticketDateFrom', values)).toBe('2026-05-01 ~ 2026-05-31')
    expect(formatFeedbackFilterChipLabel('problemType', values)).toBe('未分类')
    expect(isFeedbackFilterActive(values, 'product')).toBe(true)
  })

  it('returns disabled reasons for dependent filters', () => {
    const empty = createEmptyFeedbackFilters()
    expect(getFeedbackFilterAddDisabledReason('followUpResolved', empty)).toBe(
      '请先选择「回访」筛选条件',
    )
    expect(
      getFeedbackFilterAddDisabledReason('complaintCauseL1', empty, { showComplaintCause: false }),
    ).toBe('请先选择数据来源「投诉工单」，或清空来源筛选')
    expect(getFeedbackFilterAddDisabledReason('resourcePool', empty)).toBeUndefined()
  })
})
