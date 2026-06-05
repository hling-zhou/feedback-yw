import { describe, expect, it } from 'vitest'
import {
  isFollowUpSatisfactionImport,
  periodIdFromImportMonth,
  POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK,
} from './postUseRatingImport.js'

describe('postUseRatingImport', () => {
  it('detects follow-up satisfaction import branch', () => {
    expect(
      isFollowUpSatisfactionImport('post_use_rating', POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK),
    ).toBe(true)
    expect(isFollowUpSatisfactionImport('post_use_rating', 'standalone')).toBe(false)
    expect(
      isFollowUpSatisfactionImport('complaint_ticket', POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK),
    ).toBe(false)
  })

  it('builds period id from import month', () => {
    expect(periodIdFromImportMonth('2026-04')).toBe('period:month:2026-04')
    expect(periodIdFromImportMonth('')).toBe('')
  })
})
