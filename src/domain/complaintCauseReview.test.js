import { describe, expect, it } from 'vitest'
import {
  getComplaintCauseReviewDraftDisplay,
  hasManualComplaintCauseReview,
  isComplaintCauseReviewManuallyMaintained,
  normalizeComplaintCauseReviewInput,
  shouldIncludeComplaintCauseReviewInSave,
} from './complaintCauseReview.js'

describe('complaintCauseReview', () => {
  it('detects manual review values for l2/l3 only', () => {
    expect(hasManualComplaintCauseReview({ complaintCauseL1Review: '复核一级' })).toBe(false)
    expect(hasManualComplaintCauseReview({ complaintCauseL2Review: '复核二级' })).toBe(true)
    expect(hasManualComplaintCauseReview({})).toBe(false)
  })

  it('draft display returns l2/l3 review fields', () => {
    expect(
      getComplaintCauseReviewDraftDisplay({
        complaintCauseL1Review: 'ignored',
        complaintCauseL2Review: 'B',
        complaintCauseL3Review: 'C',
      }),
    ).toEqual({ l2: 'B', l3: 'C' })
  })

  it('save inclusion respects touch and manualTagFields', () => {
    expect(shouldIncludeComplaintCauseReviewInSave({}, false)).toBe(false)
    expect(shouldIncludeComplaintCauseReviewInSave({}, true)).toBe(true)
    expect(
      shouldIncludeComplaintCauseReviewInSave(
        { manualTagFields: ['complaintCauseReview'], complaintCauseL2Review: '' },
        false,
      ),
    ).toBe(true)
  })

  it('normalize trims l2/l3 and clears l1 review', () => {
    const long = 'x'.repeat(250)
    expect(normalizeComplaintCauseReviewInput({ l2: ` ${long} `, l3: 'c' })).toEqual({
      complaintCauseL1Review: '',
      complaintCauseL2Review: 'x'.repeat(200),
      complaintCauseL3Review: 'c',
    })
  })

  it('isComplaintCauseReviewManuallyMaintained respects manualTagFields', () => {
    expect(isComplaintCauseReviewManuallyMaintained({ complaintCauseL2Review: 'x' })).toBe(true)
    expect(
      isComplaintCauseReviewManuallyMaintained({
        manualTagFields: ['complaintCauseReview'],
        complaintCauseL2Review: '',
      }),
    ).toBe(true)
  })
})
