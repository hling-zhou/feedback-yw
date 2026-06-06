import { describe, expect, it } from 'vitest'
import {
  buildFeedbacksUrl,
  buildFollowUpDrillDownUrl,
  buildTicketWorkbenchDrillDownUrl,
  drillDownFieldParam,
  EMPTY_FILTER_TOKEN,
  isFollowUpEnrichableRecord,
  matchesFollowUpFilters,
  matchesOptionalTextFilter,
  parseFeedbackFollowUpSearchParams,
  parseFeedbackSearchParams,
  patchFeedbackFollowUpSearchParams,
  patchFeedbackSearchParams,
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
        'product=VPC&source=complaint_ticket&ticketIds=A%2CB&ticketDateFrom=2026-05-01&followUp=non10',
      ),
    )
    expect(parsed.product).toBe('VPC')
    expect(parsed.dataSource).toBe('complaint_ticket')
    expect(parsed.ticketIds).toEqual(['A', 'B'])
    expect(parsed.ticketDateFrom).toBe('2026-05-01')
    expect(parsed.followUp).toBe('non10')
  })

  it('patchFeedbackSearchParams round-trip', () => {
    const next = patchFeedbackSearchParams(new URLSearchParams('product=VPC'), {
      product: '',
      journeyL1: '开通',
      ticketIds: 'T-1,T-2',
    })
    expect(next.get('product')).toBeNull()
    expect(next.get('journeyL1')).toBe('开通')
    expect(next.get('ticketIds')).toBe('T-1,T-2')
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
        requestScene: '报障',
      }),
    ).toBe('/feedbacks?product=%E4%BA%91%E4%B8%BB%E6%9C%BA&requestScene=%E6%8A%A5%E9%9A%9C&followUp=non10')
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
})
