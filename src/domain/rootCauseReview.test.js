import { describe, expect, it } from 'vitest'
import {
  getAutoRootCauseDisplay,
  getEffectiveRootCauseReview,
  getProblemCauseDisplay,
  getRootCauseReviewDraftDisplay,
  getRootCauseReviewEditorHint,
  getRootCauseReviewEditorPlaceholder,
  getRootCauseReviewImportSuggestion,
  hasManualRootCauseReview,
  isRootCauseReviewFallbackPolluted,
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

  it('getRootCauseReviewDraftDisplay empty when not manually maintained (import not prefilled)', () => {
    const record = {
      sourceColumns: { 问题原因: '列根因' },
      rootCause: '结构化',
    }
    expect(getRootCauseReviewDraftDisplay(record)).toBe('')
    expect(getRootCauseReviewImportSuggestion(record)).toBe('列根因')
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

  it('does not prefill draft when import 问题原因 is a complaint-cause tree', () => {
    const record = {
      sourceColumns: { 问题原因: '云能问题 / 产品原因 / 计算部原因' },
      rootCause: '安全组未放行',
    }
    expect(isRootCauseReviewFallbackPolluted(record)).toBe(true)
    expect(getRootCauseReviewDraftDisplay(record)).toBe('')
    expect(getEffectiveRootCauseReview(record)).toBe('')
    expect(getRootCauseReviewEditorPlaceholder(record)).toContain('留空使用自动生成')
    expect(getRootCauseReviewEditorHint(record)).toContain('投诉原因终判路径')
  })

  it('does not prefill draft for real mechanism; only import suggestion shows it', () => {
    const record = { sourceColumns: { 问题原因: '安全组未放行' } }
    expect(isRootCauseReviewFallbackPolluted(record)).toBe(false)
    expect(getRootCauseReviewDraftDisplay(record)).toBe('')
    expect(getRootCauseReviewImportSuggestion(record)).toBe('安全组未放行')
    expect(getRootCauseReviewEditorHint(record)).not.toContain('默认展示导入列')
  })

  it('shows stored review even if it looks like a tree', () => {
    const record = {
      rootCauseReview: '云能问题 / 产品原因 / 计算部原因',
      sourceColumns: { 问题原因: '云能问题 / 产品原因 / 计算部原因' },
    }
    expect(getRootCauseReviewDraftDisplay(record)).toBe('云能问题 / 产品原因 / 计算部原因')
    expect(getRootCauseReviewEditorHint(record)).toContain('已人工复核')
  })

  it('getProblemCauseDisplay prefers manual review (人工)', () => {
    expect(getProblemCauseDisplay({ rootCauseReview: '人工复核', rootCause: '自动' })).toEqual({
      value: '人工复核',
      tag: '人工',
    })
  })

  it('getProblemCauseDisplay falls back to auto rootCause (自动)', () => {
    expect(getProblemCauseDisplay({ rootCause: '自动生成根因' })).toEqual({
      value: '自动生成根因',
      tag: '自动',
    })
  })

  it('getProblemCauseDisplay empty when neither present', () => {
    expect(getProblemCauseDisplay({})).toEqual({ value: '', tag: null })
  })

  it('getProblemCauseDisplay never uses import 问题原因 column', () => {
    expect(
      getProblemCauseDisplay({ sourceColumns: { 问题原因: '导入脏数据' }, rootCause: '' }).value,
    ).toBe('')
  })
})
