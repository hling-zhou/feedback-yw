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
})
