import { describe, expect, it } from 'vitest'
import {
  buildFeedbacksUrl,
  buildFeedbacksTicketFilterHref,
  buildFollowUpDrillDownUrl,
  buildTicketWorkbenchDrillDownUrl,
  drillDownFieldParam,
  EMPTY_FILTER_TOKEN,
  isFollowUpEnrichableRecord,
  matchesCustomerNamesFilter,
  matchesFollowUpFilters,
  matchesOptionalTextFilter,
  matchesProblemCauseSourceFilter,
  parseFeedbackFollowUpSearchParams,
  parseCustomerNamesParam,
  parseFeedbackSearchParams,
  parseProblemCauseSourceParam,
  patchFeedbackFollowUpSearchParams,
  patchFeedbackSearchParams,
  matchesHandlingKeywordFilter,
  matchesListeningReviewedFilter,
} from './feedbackFilters.js'

const withFollowUp = {
  id: '1',
  dataSourceType: 'complaint_ticket',
  followUpSatisfaction: {
    followUpTicketId: 'FH-1',
    followUpSuccessful: true,
    score: 9,
    problemResolved: 'unresolved',
    dissatisfiedReasonParts: { overallService: '响应慢' },
  },
}

const withoutFollowUp = {
  id: '2',
  dataSourceType: 'complaint_ticket',
}

const score10 = {
  id: '3',
  dataSourceType: 'consultation_ticket',
  followUpSatisfaction: {
    followUpTicketId: 'FH-2',
    followUpSuccessful: true,
    score: 10,
    problemResolved: 'resolved',
  },
}

describe('feedbackFilters', () => {
  it('isFollowUpEnrichableRecord applies to complaint and consultation only', () => {
    expect(isFollowUpEnrichableRecord(withFollowUp)).toBe(true)
    expect(isFollowUpEnrichableRecord({ dataSourceType: 'post_use_rating' })).toBe(false)
  })

  it('matchesFollowUpFilters by presence and score', () => {
    expect(matchesFollowUpFilters(withFollowUp, { followUp: 'has' })).toBe(true)
    expect(matchesFollowUpFilters(withoutFollowUp, { followUp: 'has' })).toBe(false)
    expect(matchesFollowUpFilters(withoutFollowUp, { followUp: 'none' })).toBe(true)
    expect(matchesFollowUpFilters(score10, { followUp: '10' })).toBe(true)
    expect(matchesFollowUpFilters(withFollowUp, { followUp: '10' })).toBe(false)
    expect(matchesFollowUpFilters(withFollowUp, { followUp: 'non10' })).toBe(true)
  })

  it('matchesFollowUpFilters by problem resolved', () => {
    expect(matchesFollowUpFilters(withFollowUp, { followUpResolved: 'unresolved' })).toBe(true)
    expect(matchesFollowUpFilters(withFollowUp, { followUpResolved: 'resolved' })).toBe(false)
    expect(matchesFollowUpFilters(withoutFollowUp, { followUpResolved: 'resolved' })).toBe(false)
  })

  it('matchesFollowUpFilters by reasonDim', () => {
    expect(matchesFollowUpFilters(withFollowUp, { reasonDim: 'overallService' })).toBe(true)
    expect(matchesFollowUpFilters(withFollowUp, { reasonDim: 'staffAttitudeReason' })).toBe(false)
  })

  it('parseFeedbackSearchParams includes ticket ids and drill-down fields', () => {
    const parsed = parseFeedbackSearchParams(
      new URLSearchParams(
        'product=VPC&source=complaint_ticket&ticketIds=A%2CB&customerNames=%E5%AE%A2%E6%88%B7A%2C%E5%AE%A2%E6%88%B7B&ticketDateFrom=2026-05-01&followUp=non10&handlingKeyword=%E5%B8%A6%E5%AE%BD',
      ),
    )
    expect(parsed.product).toBe('VPC')
    expect(parsed.dataSource).toBe('complaint_ticket')
    expect(parsed.ticketIds).toEqual(['A', 'B'])
    expect(parsed.customerNames).toEqual(['客户A', '客户B'])
    expect(parsed.ticketDateFrom).toBe('2026-05-01')
    expect(parsed.followUp).toBe('non10')
    expect(parsed.handlingKeyword).toBe('带宽')
  })

  it('parses singular ticketId into ticketIds filter and prefers ticketIds', () => {
    expect(parseFeedbackSearchParams(new URLSearchParams('ticketId=T-1')).ticketIds).toEqual(['T-1'])
    expect(
      parseFeedbackSearchParams(new URLSearchParams('ticketId=OLD&ticketIds=A%2CB')).ticketIds,
    ).toEqual(['A', 'B'])
  })

  it('buildFeedbacksTicketFilterHref uses ticketIds without opening a single-ticket param', () => {
    expect(buildFeedbacksTicketFilterHref('T-1')).toBe('/feedbacks?ticketIds=T-1')
    expect(buildFeedbacksTicketFilterHref('')).toBe('/feedbacks')
  })

  it('parseFeedbackSearchParams includes post-use rating filters', () => {
    const parsed = parseFeedbackSearchParams(
      new URLSearchParams('ratingScore=non10&channel=sms&commentKeyword=%E5%BB%B6%E8%BF%9F'),
    )
    expect(parsed.ratingScore).toBe('non10')
    expect(parsed.channel).toBe('sms')
    expect(parsed.commentKeyword).toBe('延迟')
  })

  it('patchFeedbackSearchParams round-trip', () => {
    const next = patchFeedbackSearchParams(new URLSearchParams('product=VPC'), {
      product: '',
      journeyL1: '开通',
      ticketIds: 'T-1,T-2',
      customerNames: '客户A,客户B',
      handlingKeyword: '安全组',
    })
    expect(next.get('product')).toBeNull()
    expect(next.get('journeyL1')).toBe('开通')
    expect(next.get('ticketIds')).toBe('T-1,T-2')
    expect(next.get('customerNames')).toBe('客户A,客户B')
    expect(next.get('handlingKeyword')).toBe('安全组')
  })

  it('parses and patches ticketIdSet without putting ids in ticketIds', () => {
    const parsed = parseFeedbackSearchParams(new URLSearchParams('source=complaint_ticket&ticketIdSet=abc-1'))
    expect(parsed.ticketIdSet).toBe('abc-1')
    expect(parsed.ticketIds).toEqual([])
    const next = patchFeedbackSearchParams(new URLSearchParams('ticketIdSet=abc-1&source=complaint_ticket'), {
      ticketIdSet: '',
    })
    expect(next.get('ticketIdSet')).toBeNull()
    expect(next.get('source')).toBe('complaint_ticket')
  })

  it('patchFeedbackSearchParams round-trips post-use rating filters', () => {
    const next = patchFeedbackSearchParams(new URLSearchParams(), {
      ratingScore: 'lt7',
      channel: 'console',
      commentKeyword: '卡顿',
    })
    expect(next.get('ratingScore')).toBe('lt7')
    expect(next.get('channel')).toBe('console')
    expect(next.get('commentKeyword')).toBe('卡顿')
  })

  it('matchesHandlingKeywordFilter does case-insensitive substring match on handlingText', () => {
    const record = { handlingText: '已协助客户调整 SecurityGroup 并复测通过' }
    expect(matchesHandlingKeywordFilter(record, '')).toBe(true)
    expect(matchesHandlingKeywordFilter(record, 'securitygroup')).toBe(true)
    expect(matchesHandlingKeywordFilter(record, '调整')).toBe(true)
    expect(matchesHandlingKeywordFilter(record, '带宽')).toBe(false)
    expect(matchesHandlingKeywordFilter({ handlingText: '' }, '调整')).toBe(false)
  })

  it('matchesListeningReviewedFilter by yes/no', () => {
    expect(matchesListeningReviewedFilter({ listeningReviewed: true }, '')).toBe(true)
    expect(matchesListeningReviewedFilter({ listeningReviewed: true }, 'yes')).toBe(true)
    expect(matchesListeningReviewedFilter({ listeningReviewed: false }, 'yes')).toBe(false)
    expect(matchesListeningReviewedFilter({ listeningReviewed: false }, 'no')).toBe(true)
    expect(matchesListeningReviewedFilter({ listeningReviewed: true }, 'no')).toBe(false)
    expect(matchesListeningReviewedFilter({}, 'no')).toBe(true)
  })

  it('parseFeedbackSearchParams includes listeningReviewed', () => {
    const parsed = parseFeedbackSearchParams(new URLSearchParams('listeningReviewed=yes'))
    expect(parsed.listeningReviewed).toBe('yes')
    expect(parseFeedbackSearchParams(new URLSearchParams('listeningReviewed=maybe')).listeningReviewed).toBe(
      '',
    )
  })

  it('matchesCustomerNamesFilter by exact customer name', () => {
    expect(matchesCustomerNamesFilter({ customerName: '客户A' }, ['客户A'])).toBe(true)
    expect(matchesCustomerNamesFilter({ customerName: '客户A' }, ['客户B'])).toBe(false)
    expect(matchesCustomerNamesFilter({ customerName: '' }, ['客户A'])).toBe(false)
    expect(matchesCustomerNamesFilter({ customerName: '客户A' }, [])).toBe(true)
    expect(parseCustomerNamesParam('客户A,%E5%AE%A2%E6%88%B7B')).toEqual(['客户A', '客户B'])
  })

  it('parseFeedbackFollowUpSearchParams and patch round-trip', () => {
    const parsed = parseFeedbackFollowUpSearchParams(
      new URLSearchParams('followUp=non10&followUpResolved=unresolved&reasonDim=overallService&requestScene=报障'),
    )
    expect(parsed).toEqual({
      followUp: 'non10',
      followUpResolved: 'unresolved',
      reasonDim: 'overallService',
      requestScene: '报障',
      ticketDateFrom: null,
      ticketDateTo: null,
    })

    const next = patchFeedbackFollowUpSearchParams(new URLSearchParams('product=VPC'), {
      followUp: '10',
      followUpResolved: '',
    })
    expect(next.get('product')).toBe('VPC')
    expect(next.get('followUp')).toBe('10')
    expect(next.has('followUpResolved')).toBe(false)
  })

  it('buildFeedbacksUrl encodes drill-down params', () => {
    expect(
      buildFeedbacksUrl({
        followUp: 'non10',
        product: '云主机',
        customerNames: '客户A',
        lane: 'post_use',
        requestScene: '报障',
      }),
    ).toBe('/feedbacks?product=%E4%BA%91%E4%B8%BB%E6%9C%BA&requestScene=%E6%8A%A5%E9%9A%9C&followUp=non10&customerNames=%E5%AE%A2%E6%88%B7A&lane=post_use')
  })

  it('buildFollowUpDrillDownUrl defaults followUp to non10', () => {
    expect(
      buildFollowUpDrillDownUrl({
        productName: '云主机',
        problemType: '故障',
        reasonDim: 'overallService',
      }),
    ).toBe(
      '/feedbacks?product=%E4%BA%91%E4%B8%BB%E6%9C%BA&problemType=%E6%95%85%E9%9A%9C&followUp=non10&reasonDim=overallService',
    )
  })

  it('buildTicketWorkbenchDrillDownUrl encodes ticket tab drill-down params', () => {
    expect(
      buildTicketWorkbenchDrillDownUrl({
        source: 'complaint_ticket',
        month: '2026-04',
        product: '云主机',
        requestScene: '报障',
      }),
    ).toBe(
      '/feedbacks?month=2026-04&product=%E4%BA%91%E4%B8%BB%E6%9C%BA&requestScene=%E6%8A%A5%E9%9A%9C&source=complaint_ticket',
    )
  })

  it('matchesOptionalTextFilter supports __empty__ for unclassified drill-down', () => {
    expect(matchesOptionalTextFilter('', EMPTY_FILTER_TOKEN)).toBe(true)
    expect(matchesOptionalTextFilter('报障', EMPTY_FILTER_TOKEN)).toBe(false)
    expect(drillDownFieldParam('未分类')).toBe(EMPTY_FILTER_TOKEN)
    expect(drillDownFieldParam('报障')).toBe('报障')
  })

  it('parseProblemCauseSourceParam accepts auto/manual only', () => {
    expect(parseProblemCauseSourceParam('auto')).toBe('auto')
    expect(parseProblemCauseSourceParam('manual')).toBe('manual')
    expect(parseProblemCauseSourceParam('')).toBe('')
    expect(parseProblemCauseSourceParam('bogus')).toBe('')
  })

  it('matchesProblemCauseSourceFilter matches manual/auto root cause source', () => {
    const manual = { rootCauseReview: '人工复核根因' }
    const auto = { rootCause: '自动根因' }
    const none = {}
    expect(matchesProblemCauseSourceFilter(manual, '')).toBe(true)
    expect(matchesProblemCauseSourceFilter(manual, 'manual')).toBe(true)
    expect(matchesProblemCauseSourceFilter(manual, 'auto')).toBe(false)
    expect(matchesProblemCauseSourceFilter(auto, 'auto')).toBe(true)
    expect(matchesProblemCauseSourceFilter(auto, 'manual')).toBe(false)
    expect(matchesProblemCauseSourceFilter(none, 'auto')).toBe(false)
    expect(matchesProblemCauseSourceFilter(none, 'manual')).toBe(false)
  })

  it('parseFeedbackSearchParams includes problemCauseSource', () => {
    const parsed = parseFeedbackSearchParams(new URLSearchParams('problemCauseSource=manual'))
    expect(parsed.problemCauseSource).toBe('manual')
    expect(parseFeedbackSearchParams(new URLSearchParams('problemCauseSource=bad')).problemCauseSource).toBe('')
  })

  it('patchFeedbackSearchParams round-trips problemCauseSource', () => {
    const next = patchFeedbackSearchParams(new URLSearchParams(), { problemCauseSource: 'auto' })
    expect(next.get('problemCauseSource')).toBe('auto')
    const cleared = patchFeedbackSearchParams(new URLSearchParams('problemCauseSource=auto'), {
      problemCauseSource: '',
    })
    expect(cleared.has('problemCauseSource')).toBe(false)
  })

  it('buildFeedbacksUrl serializes problemCauseSource', () => {
    expect(buildFeedbacksUrl({ problemCauseSource: 'manual' })).toBe(
      '/feedbacks?problemCauseSource=manual',
    )
  })
})
