import { describe, expect, it } from 'vitest'
import {
  clearComplaintCauseReviewFields,
  getComplaintCauseReviewDraftDisplay,
  hasManualComplaintCauseReview,
  hasPendingComplaintCauseReview,
  isCompleteComplaintCauseReview,
  isComplaintCauseReviewManuallyMaintained,
  normalizeComplaintCauseReviewInput,
  shouldIncludeComplaintCauseReviewInSave,
} from './complaintCauseReview.js'
import { isComplaintCauseReviewPending } from './complaintCauseReviewArchive.js'

const completeReview = {
  complaintCauseL1Review: '云能问题',
  complaintCauseL2Review: '产品原因',
  complaintCauseL3Review: '计算部原因',
  complaintCauseReviewReason: '分类不准',
}

describe('complaintCauseReview', () => {
  it('detects pending review for l1/l2/l3/reason', () => {
    expect(hasManualComplaintCauseReview({ complaintCauseL1Review: '复核一级' })).toBe(true)
    expect(hasPendingComplaintCauseReview({ complaintCauseReviewReason: '需改' })).toBe(true)
    expect(hasManualComplaintCauseReview({ complaintCauseL2Review: '复核二级' })).toBe(true)
    expect(hasManualComplaintCauseReview({})).toBe(false)
  })

  it('isCompleteComplaintCauseReview requires valid path and reason', () => {
    expect(isCompleteComplaintCauseReview(completeReview)).toBe(true)
    expect(
      isCompleteComplaintCauseReview({
        ...completeReview,
        complaintCauseReviewReason: '',
      }),
    ).toBe(false)
    expect(
      isCompleteComplaintCauseReview({
        complaintCauseReviewReason: '仅原因',
      }),
    ).toBe(false)
    expect(isComplaintCauseReviewPending({ complaintCauseReviewReason: '仅原因' })).toBe(false)
    expect(isComplaintCauseReviewPending(completeReview)).toBe(true)
  })

  it('draft display returns l1/l2/l3/reason', () => {
    expect(
      getComplaintCauseReviewDraftDisplay({
        complaintCauseL1Review: 'A',
        complaintCauseL2Review: 'B',
        complaintCauseL3Review: 'C',
        complaintCauseReviewReason: '原因',
      }),
    ).toEqual({ l1: 'A', l2: 'B', l3: 'C', reason: '原因' })
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

  it('normalize trims l1/l2/l3/reason', () => {
    const long = 'x'.repeat(250)
    expect(
      normalizeComplaintCauseReviewInput({ l1: ' 一级 ', l2: ` ${long} `, l3: 'c', reason: ' r ' }),
    ).toEqual({
      complaintCauseL1Review: '一级',
      complaintCauseL2Review: 'x'.repeat(200),
      complaintCauseL3Review: 'c',
      complaintCauseReviewReason: 'r',
    })
  })

  it('clearComplaintCauseReviewFields empties all pending fields', () => {
    expect(clearComplaintCauseReviewFields()).toEqual({
      complaintCauseL1Review: '',
      complaintCauseL2Review: '',
      complaintCauseL3Review: '',
      complaintCauseReviewReason: '',
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
