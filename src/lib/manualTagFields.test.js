import { describe, expect, it } from 'vitest'
import {
  getManualTagFields,
  mergeManualTagFieldsOnUserEdit,
  preserveManualTags,
  applyForceRetagOverrides,
} from './manualTagFields.js'

const base = {
  id: '1',
  rawText: 't',
  customerQuote: 't',
  requestScene: '咨询',
  problemType: '配额与权限申请',
  journeyL1: '产品订改续',
  journeyL2: '权限及配额限制',
  sentiment: 'neutral',
  themes: ['权限及配额限制'],
  problemSummary: '',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  status: 'open',
  importedAt: '2026-01-01',
}

describe('manualTagFields', () => {
  it('mergeManualTagFieldsOnUserEdit accumulates dimensions from patch keys', () => {
    expect(
      mergeManualTagFieldsOnUserEdit(
        { ...base, manualTagFields: ['requestScene'] },
        { problemType: '计费与账单', journeyL2: '计费模式咨询' },
      ),
    ).toEqual(['requestScene', 'problemType', 'journey'])
  })

  it('preserveManualTags keeps manual dimensions after auto retag output', () => {
    const original = {
      ...base,
      manualTagFields: ['journey', 'sentiment'],
      journeyL2: '人工环节',
      themes: ['人工环节'],
      sentiment: 'negative',
    }
    const processed = {
      ...original,
      journeyL2: '自动环节',
      themes: ['自动环节'],
      sentiment: 'neutral',
      requestScene: '报障',
    }
    const kept = preserveManualTags(original, processed)
    expect(kept.journeyL2).toBe('人工环节')
    expect(kept.themes).toEqual(['人工环节'])
    expect(kept.sentiment).toBe('negative')
    expect(kept.requestScene).toBe('报障')
    expect(getManualTagFields(kept)).toEqual(['journey', 'sentiment'])
  })

  it('applyForceRetagOverrides clears manual tags and review text', () => {
    const cleared = applyForceRetagOverrides({
      ...base,
      manualTagFields: ['journey', 'optimization'],
      manualReviewRootCause: '人工根因',
      manualReviewSolution: '人工方案',
      manualReviewAction: '人工举措',
      manualReviewOptimization: '人工优化',
    })
    expect(getManualTagFields(cleared)).toEqual([])
    expect(cleared.manualReviewRootCause).toBe('')
    expect(cleared.manualReviewSolution).toBe('')
    expect(cleared.manualReviewAction).toBe('')
    expect(cleared.manualReviewOptimization).toBe('')
  })

  it('preserveManualTags skips restore when forceOverride is true', () => {
    const original = {
      ...base,
      manualTagFields: ['journey', 'sentiment'],
      journeyL2: '人工环节',
      themes: ['人工环节'],
      sentiment: 'negative',
    }
    const processed = {
      ...original,
      journeyL2: '自动环节',
      themes: ['自动环节'],
      sentiment: 'neutral',
    }
    const kept = preserveManualTags(original, processed, { forceOverride: true })
    expect(kept.journeyL2).toBe('自动环节')
    expect(kept.sentiment).toBe('neutral')
  })
})
