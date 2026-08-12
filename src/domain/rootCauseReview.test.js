import { describe, expect, it } from 'vitest'
import {
  getAutoRootCauseDisplay,
  getEffectiveRootCauseReview,
  getRootCauseReviewDraftDisplay,
  hasManualRootCauseReview,
  isRootCauseReviewManuallyMaintained,
  normalizeRootCauseReviewInput,
  ROOT_CAUSE_REVIEW_MAX_LENGTH,
  shouldIncludeRootCauseReviewInSave,
} from './rootCauseReview.js'

describe('rootCauseReview', () => {
  it('getAutoRootCauseDisplay reads rootCause field', () => {
    expect(getAutoRootCauseDisplay({ rootCause: '磁盘满' })).toBe('磁盘满')
    expect(getAutoRootCauseDisplay({ rootCause: '  ' })).toBe('')
    expect(getAutoRootCauseDisplay({})).toBe('')
  })

  it('getEffectiveRootCauseReview prefers stored value', () => {
    expect(
      getEffectiveRootCauseReview({
        rootCauseReview: '人工排查',
        sourceColumns: { 问题原因: '列根因' },
        rootCause: '结构化',
      }),
    ).toBe('人工排查')
  })

  it('getEffectiveRootCauseReview falls back to 问题原因 column only', () => {
    expect(
      getEffectiveRootCauseReview({
        sourceColumns: { 问题原因: '列根因' },
        rootCause: '结构化',
      }),
    ).toBe('列根因')
    expect(getEffectiveRootCauseReview({ rootCause: '结构化' })).toBe('')
    expect(getEffectiveRootCauseReview({ sourceColumns: {} })).toBe('')
  })

  it('hasManualRootCauseReview detects saved review text', () => {
    expect(hasManualRootCauseReview({ rootCauseReview: 'x' })).toBe(true)
    expect(hasManualRootCauseReview({ rootCause: 'x' })).toBe(false)
  })

  it('getRootCauseReviewDraftDisplay shows effective default when not manually maintained', () => {
    const record = {
      sourceColumns: { 问题原因: '列根因' },
      rootCause: '结构化',
    }
    expect(getRootCauseReviewDraftDisplay(record)).toBe('列根因')
  })

  it('getRootCauseReviewDraftDisplay shows stored value when manually maintained', () => {
    expect(
      getRootCauseReviewDraftDisplay({
        rootCauseReview: '',
        manualTagFields: ['rootCauseReview'],
        sourceColumns: { 问题原因: '列根因' },
      }),
    ).toBe('')
    expect(
      getRootCauseReviewDraftDisplay({
        rootCauseReview: '人工',
        sourceColumns: { 问题原因: '列根因' },
      }),
    ).toBe('人工')
  })

  it('shouldIncludeRootCauseReviewInSave only when touched or already manual', () => {
    const record = { sourceColumns: { 问题原因: '列根因' } }
    expect(shouldIncludeRootCauseReviewInSave(record, false)).toBe(false)
    expect(shouldIncludeRootCauseReviewInSave(record, true)).toBe(true)
    expect(
      shouldIncludeRootCauseReviewInSave(
        { manualTagFields: ['rootCauseReview'], rootCauseReview: '' },
        false,
      ),
    ).toBe(true)
  })

  it('normalizeRootCauseReviewInput trims and caps length', () => {
    expect(normalizeRootCauseReviewInput('  abc  ')).toBe('abc')
    expect(normalizeRootCauseReviewInput('x'.repeat(ROOT_CAUSE_REVIEW_MAX_LENGTH + 5)).length).toBe(
      ROOT_CAUSE_REVIEW_MAX_LENGTH,
    )
  })

  it('getEffectiveRootCauseReview never uses complaint cause Final concatenation', () => {
    expect(
      getEffectiveRootCauseReview({
        complaintCauseL1Final: '云能问题',
        complaintCauseL2Final: '产品原因',
        complaintCauseL3Final: '计算部原因',
        rootCause: '云能问题 / 产品原因 / 计算部原因',
        sourceColumns: {
          '投诉原因 一级（终判）': '云能问题',
          '投诉原因 二级（终判）': '产品原因',
          '投诉原因 三级（终判）': '计算部原因',
        },
      }),
    ).toBe('')
    expect(
      getEffectiveRootCauseReview({
        complaintCauseL1Final: '云能问题',
        complaintCauseL2Final: '产品原因',
        complaintCauseL3Final: '计算部原因',
        sourceColumns: { 问题原因: '安全组未放行' },
      }),
    ).toBe('安全组未放行')
  })

  it('getRootCauseReviewDraftDisplay never falls back to Final concat', () => {
    expect(
      getRootCauseReviewDraftDisplay({
        complaintCauseL1Final: '云能问题',
        complaintCauseL2Final: '产品原因',
        complaintCauseL3Final: '计算部原因',
        rootCause: '云能问题/产品原因/计算部原因',
      }),
    ).toBe('')
  })
})
