import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Feedbacks lane-scoped notices', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'Feedbacks.jsx'), 'utf8')

  it('uses the active lane for counts and filtered records', () => {
    expect(source).toContain('isPostUseRatingLibraryRecord')
    expect(source).toContain('isPostUseLane')
    expect(source).toContain('laneVisiblePeriodCount')
    expect(source).toContain("isPostUseLane ? 'post_use_rating' : filters.dataSource || ''")
    expect(source).toContain('matchesCustomerNamesFilter(fb, filters.customerNames)')
  })

  it('keeps ticket quality notices off the post-use lane', () => {
    expect(source).toContain('{!isPostUseLane &&')
    expect(source).toContain('summarizeUnknownJourneyRecords(periodFeedbacks)')
    expect(source).toContain('countRecordsNeedingTicketLlmEnrichment(periodFeedbacks)')
    expect(source).toContain('countRecordsNeedingJourneyLlmEnrichment(periodFeedbacks, settings)')
    expect(source).toContain("downloadUnknownJourneyCsv(periodFeedbacks, '未识别旅程样本.csv')")
  })

  it('clears filters when switching between ticket and post-use lanes', () => {
    expect(source).toContain('两大类 Tab 筛选相互独立')
    expect(source).toContain('clearAllFeedbackFilters()')
    expect(source).toContain('feedbackFiltersToUrlPatch(cleared)')
  })

  it('wires customer name options into the composite filter', () => {
    expect(source).toContain('const customerNameOptions = useMemo')
    expect(source).toContain('fb.customerName')
    expect(source).toContain('customerNameOptions,')
    expect(source).toContain('ticketIdOptions,')
  })

  it('narrows post-use composite keys and keeps source locked on clear', () => {
    expect(source).toContain('FEEDBACK_POST_USE_COMPOSITE_KEYS')
    expect(source).toContain('FEEDBACK_TICKET_COMPOSITE_KEYS')
    expect(source).toContain('restrictFeedbackFiltersToKeys')
    expect(source).toContain("if (isPostUseLane) next.dataSource = 'post_use_rating'")
    expect(source).toContain('filterOptionRecords')
    expect(source).toContain('ratingScoreOptions')
    expect(source).toContain('channelOptions')
    expect(source).toContain('matchesCommentKeywordFilter')
    expect(source).toContain('matchesPostUseRatingFilter')
    expect(source).toContain('matchesPostUseChannelFilter')
  })

  it('does not auto-open the drawer from a ticketId query', () => {
    expect(source).not.toContain("searchParams.get('ticketId')")
    expect(source).toContain('selectedTicketIdSet')
  })
})
