import { describe, expect, it } from 'vitest'
import {
  countActiveFeedbackFilters,
  createEmptyFeedbackFilters,
  FEEDBACK_FILTER_CHIP_VALUE_MAX_LEN,
  FEEDBACK_POST_USE_COMPOSITE_KEYS,
  FEEDBACK_TICKET_COMPOSITE_KEYS,
  formatFeedbackFilterChipLabel,
  getFeedbackFilterAddDisabledReason,
  isFeedbackFilterActive,
  listActiveFeedbackFilterChipKeys,
  restrictFeedbackFiltersToKeys,
  truncateFeedbackFilterChipValue,
} from './feedbackFilterModel.js'
import { EMPTY_FILTER_TOKEN } from './feedbackFilters.js'

describe('feedbackFilterModel', () => {
  it('lists active chip keys and formats labels', () => {
    const values = {
      ...createEmptyFeedbackFilters(),
      product: '云主机',
      ticketIds: ['A', 'B'],
      customerNames: ['客户甲', '客户乙'],
      ticketDateFrom: '2026-05-01',
      ticketDateTo: '2026-05-31',
      followUp: 'non10',
      problemType: EMPTY_FILTER_TOKEN,
      handlingKeyword: '安全组放行端口后复测通过仍异常请继续排查带宽打满问题',
    }
    expect(listActiveFeedbackFilterChipKeys(values)).toEqual([
      'ticketIds',
      'customerNames',
      'handlingKeyword',
      'ticketDateFrom',
      'problemType',
      'followUp',
    ])
    expect(countActiveFeedbackFilters(values)).toBe(6)
    expect(formatFeedbackFilterChipLabel('ticketIds', values)).toBe('2 个')
    expect(formatFeedbackFilterChipLabel('customerNames', values)).toBe('2 个')
    expect(formatFeedbackFilterChipLabel('handlingKeyword', values)).toBe(
      '安全组放行端口后复测通过仍异常请继续排查带宽打满问题'.slice(0, 24) + '…',
    )
    expect(formatFeedbackFilterChipLabel('ticketDateFrom', values)).toBe('2026-05-01 ~ 2026-05-31')
    expect(formatFeedbackFilterChipLabel('problemType', values)).toBe('未分类')
    expect(isFeedbackFilterActive(values, 'product')).toBe(true)
    expect(isFeedbackFilterActive(values, 'customerNames')).toBe(true)
    expect(isFeedbackFilterActive(values, 'handlingKeyword')).toBe(true)
  })

  it('formats post-use rating, channel and comment chips', () => {
    const values = {
      ...createEmptyFeedbackFilters(),
      ratingScore: 'non10',
      channel: 'sms',
      commentKeyword: '延迟高到无法使用请尽快处理网络质量问题',
    }
    expect(formatFeedbackFilterChipLabel('ratingScore', values)).toBe('非 10 分')
    expect(formatFeedbackFilterChipLabel('channel', values)).toBe('短信')
    expect(formatFeedbackFilterChipLabel('commentKeyword', values)).toBe(
      '延迟高到无法使用请尽快处理网络质量问题',
    )
    expect(formatFeedbackFilterChipLabel('ratingScore', { ...values, ratingScore: '8' })).toBe('8 分')
  })

  it('truncates a single long ticket id or customer name on the chip', () => {
    const longTicketId = '20260709171401X441606122'
    const longCustomerName = '中国铁塔某某省分公司云网业务部'
    expect(longTicketId.length).toBeGreaterThan(FEEDBACK_FILTER_CHIP_VALUE_MAX_LEN)
    expect(formatFeedbackFilterChipLabel('ticketIds', {
      ...createEmptyFeedbackFilters(),
      ticketIds: [longTicketId],
    })).toBe(truncateFeedbackFilterChipValue(longTicketId))
    expect(formatFeedbackFilterChipLabel('ticketIds', {
      ...createEmptyFeedbackFilters(),
      ticketIds: ['A'],
    })).toBe('A')
    expect(formatFeedbackFilterChipLabel('customerNames', {
      ...createEmptyFeedbackFilters(),
      customerNames: [longCustomerName],
    })).toBe(truncateFeedbackFilterChipValue(longCustomerName))
    expect(formatFeedbackFilterChipLabel('customerNames', {
      ...createEmptyFeedbackFilters(),
      customerNames: ['客户甲'],
    })).toBe('客户甲')
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

  it('restricts filters to a lane key set while keeping product', () => {
    const values = {
      ...createEmptyFeedbackFilters(),
      product: '云主机',
      ticketIds: ['A'],
      followUp: 'non10',
      customerNames: ['客户甲'],
      dataSource: 'complaint_ticket',
    }
    const next = restrictFeedbackFiltersToKeys(values, FEEDBACK_POST_USE_COMPOSITE_KEYS, {
      dataSource: 'post_use_rating',
    })
    expect(next.product).toBe('云主机')
    expect(next.ticketIds).toEqual(['A'])
    expect(next.customerNames).toEqual(['客户甲'])
    expect(next.followUp).toBe('')
    expect(next.dataSource).toBe('post_use_rating')
  })

  it('keeps post-use rating/channel/comment keys and drops ticket-only filters', () => {
    const values = {
      ...createEmptyFeedbackFilters(),
      ratingScore: 'non10',
      channel: 'sms',
      commentKeyword: '延迟',
      handlingKeyword: '处理意见',
      followUp: 'has',
    }
    const next = restrictFeedbackFiltersToKeys(values, FEEDBACK_POST_USE_COMPOSITE_KEYS)
    expect(next.ratingScore).toBe('non10')
    expect(next.channel).toBe('sms')
    expect(next.commentKeyword).toBe('延迟')
    expect(next.handlingKeyword).toBe('')
    expect(next.followUp).toBe('')
    expect(FEEDBACK_POST_USE_COMPOSITE_KEYS).toEqual(
      expect.arrayContaining(['ratingScore', 'channel', 'commentKeyword']),
    )
    expect(FEEDBACK_TICKET_COMPOSITE_KEYS).not.toContain('ratingScore')
    expect(FEEDBACK_TICKET_COMPOSITE_KEYS).not.toContain('channel')
    expect(FEEDBACK_TICKET_COMPOSITE_KEYS).not.toContain('commentKeyword')
  })

  it('keeps ticket date range when restricting to post-use keys', () => {
    const values = {
      ...createEmptyFeedbackFilters(),
      ticketDateFrom: '2026-08-01',
      ticketDateTo: '2026-08-14',
      followUp: 'non10',
    }
    const next = restrictFeedbackFiltersToKeys(values, FEEDBACK_POST_USE_COMPOSITE_KEYS)
    expect(next.ticketDateFrom).toBe('2026-08-01')
    expect(next.ticketDateTo).toBe('2026-08-14')
    expect(next.followUp).toBe('')
  })
})
