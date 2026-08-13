import { describe, expect, it } from 'vitest'
import {
  FEEDBACK_LANE_POST_USE,
  FEEDBACK_LANE_TICKETS,
  countFeedbackRecordsByLane,
  filterFeedbackRecordsForLane,
  isCustomerVisitImport,
  isFollowUpSatisfactionImport,
  isPostUseChannelBundleImport,
  isPostUseNon10LibraryRecord,
  isPostUseRatingCallbackRecord,
  isPostUseRatingLibraryRecord,
  normalizeFeedbackLaneDataSource,
  periodIdFromImportMonth,
  POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT,
  POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK,
  POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE,
  resolveFeedbackLane,
} from './postUseRatingImport.js'

describe('postUseRatingImport', () => {
  it('detects follow-up satisfaction import branch', () => {
    expect(
      isFollowUpSatisfactionImport('post_use_rating', POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK),
    ).toBe(true)
    expect(
      isFollowUpSatisfactionImport('complaint_ticket', POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK),
    ).toBe(false)
  })

  it('detects channel bundle import', () => {
    expect(isPostUseChannelBundleImport('post_use_rating', POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE)).toBe(
      true,
    )
    expect(
      isPostUseChannelBundleImport('post_use_rating', POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK),
    ).toBe(false)
  })

  it('builds period id from import month', () => {
    expect(periodIdFromImportMonth('2026-04')).toBe('period:month:2026-04')
    expect(periodIdFromImportMonth('')).toBe('')
  })

  it('identifies callback rows to hide from feedback library', () => {
    expect(
      isPostUseRatingCallbackRecord({
        dataSourceType: 'post_use_rating',
        channel: 'callback',
        sourceSubType: 'satisfaction_callback',
      }),
    ).toBe(true)
    expect(
      isPostUseRatingLibraryRecord({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        sourceSubType: 'sms_survey',
      }),
    ).toBe(true)
    expect(
      isPostUseRatingLibraryRecord({
        dataSourceType: 'post_use_rating',
        channel: 'callback',
        sourceSubType: 'satisfaction_callback',
      }),
    ).toBe(false)
  })

  it('detects customer visit import and non-10 library rows', () => {
    expect(isCustomerVisitImport('post_use_rating', POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT)).toBe(
      true,
    )
    expect(
      isPostUseNon10LibraryRecord({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 9,
      }),
    ).toBe(true)
    expect(
      isPostUseNon10LibraryRecord({
        dataSourceType: 'post_use_rating',
        channel: 'sms',
        ratingScore: 10,
      }),
    ).toBe(false)
  })

  it('resolveFeedbackLane from lane or source', () => {
    expect(resolveFeedbackLane('post_use')).toBe(FEEDBACK_LANE_POST_USE)
    expect(resolveFeedbackLane(new URLSearchParams('lane=tickets'))).toBe(FEEDBACK_LANE_TICKETS)
    expect(resolveFeedbackLane(new URLSearchParams('source=post_use_rating'))).toBe(
      FEEDBACK_LANE_POST_USE,
    )
    expect(resolveFeedbackLane({})).toBe(FEEDBACK_LANE_TICKETS)
  })

  it('constrains data sources to the active feedback lane', () => {
    expect(normalizeFeedbackLaneDataSource(FEEDBACK_LANE_TICKETS, 'complaint_ticket')).toBe(
      'complaint_ticket',
    )
    expect(normalizeFeedbackLaneDataSource(FEEDBACK_LANE_TICKETS, 'post_use_rating')).toBe('')
    expect(normalizeFeedbackLaneDataSource(FEEDBACK_LANE_POST_USE, 'complaint_ticket')).toBe(
      'post_use_rating',
    )
    expect(normalizeFeedbackLaneDataSource(FEEDBACK_LANE_POST_USE, '')).toBe('post_use_rating')
  })

  it('keeps ticket and post-use lane records strictly separated', () => {
    const mixed = [
      { id: 'legacy-ticket' },
      { id: 'complaint', dataSourceType: 'complaint_ticket' },
      { id: 'consultation', dataSourceType: 'consultation_ticket' },
      { id: 'rating', dataSourceType: 'post_use_rating', channel: 'sms' },
      { id: 'callback', dataSourceType: 'post_use_rating', channel: 'callback' },
      { id: 'survey', dataSourceType: 'user_survey' },
    ]

    expect(filterFeedbackRecordsForLane(mixed, FEEDBACK_LANE_TICKETS).map((r) => r.id)).toEqual([
      'legacy-ticket',
      'complaint',
      'consultation',
    ])
    expect(filterFeedbackRecordsForLane(mixed, FEEDBACK_LANE_POST_USE).map((r) => r.id)).toEqual([
      'rating',
    ])
    expect(countFeedbackRecordsByLane(mixed)).toEqual({ tickets: 3, postUse: 1 })
  })
})
