import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('Feedbacks lane-scoped notices', () => {
  const source = readFileSync(resolve(import.meta.dirname, 'Feedbacks.jsx'), 'utf8')

  it('uses the active lane SSOT for counts and records', () => {
    expect(source).toContain('countFeedbackRecordsByLane(periodFeedbacks)')
    expect(source).toContain('filterFeedbackRecordsForLane(periodFeedbacks, feedbackLane)')
    expect(source).toContain('scopePostUseRatingRecords(')
    expect(source).toContain('postUse: scopedPostUsePeriodFeedbacks.length')
    expect(source).toContain('? scopedPostUsePeriodFeedbacks')
  })

  it('keeps ticket quality notices and export out of post-use records', () => {
    expect(source).toContain('isPostUseLane ? [] : lanePeriodFeedbacks')
    expect(source).toContain('summarizeUnknownJourneyRecords(ticketQualityRecords)')
    expect(source).toContain('countRecordsNeedingTicketLlmEnrichment(ticketQualityRecords)')
    expect(source).toContain('countRecordsNeedingJourneyLlmEnrichment(ticketQualityRecords, settings)')
    expect(source).toContain("downloadUnknownJourneyCsv(ticketQualityRecords, '未识别旅程样本.csv')")
  })
})
