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
  it('mergeManualTagFieldsOnUserEdit accumulates dimensions only when values change', () => {
    expect(
      mergeManualTagFieldsOnUserEdit(
        { ...base, manualTagFields: ['requestScene'] },
        { problemType: '计费与账单', journeyL2: '计费模式咨询' },
      ),
    ).toEqual(['requestScene', 'problemType', 'journey'])
    expect(
      mergeManualTagFieldsOnUserEdit(base, {
        requestScene: base.requestScene,
        problemType: base.problemType,
      }),
    ).toEqual([])
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

  it('mergeManualTagFieldsOnUserEdit marks optimization when actionSchedule edited', () => {
    expect(
      mergeManualTagFieldsOnUserEdit(base, { actionSchedule: '2026-08-01' }),
    ).toContain('optimization')
  })

  it('mergeManualTagFieldsOnUserEdit marks complaintCauseReview when review fields change', () => {
    expect(
      mergeManualTagFieldsOnUserEdit(base, { complaintCauseL2Review: '复核二级' }),
    ).toContain('complaintCauseReview')
  })

  it('preserveManualTags keeps complaint cause review fields', () => {
    const original = {
      ...base,
      manualTagFields: ['complaintCauseReview'],
      complaintCauseL1Review: '复核一级',
      complaintCauseL2Review: '复核二级',
      complaintCauseL3Review: '复核三级',
    }
    const processed = {
      ...original,
      complaintCauseL1Review: '',
      complaintCauseL2Review: '',
      complaintCauseL3Review: '',
    }
    const kept = preserveManualTags(original, processed)
    expect(kept.complaintCauseL1Review).toBe('复核一级')
    expect(kept.complaintCauseL2Review).toBe('复核二级')
    expect(kept.complaintCauseL3Review).toBe('复核三级')
  })

  it('applyForceRetagOverrides clears manual tags, review text, and resets rootCauseReview', () => {
    const cleared = applyForceRetagOverrides({
      ...base,
      manualTagFields: ['journey', 'optimization'],
      manualReviewRootCause: '人工根因',
      manualReviewSolution: '人工方案',
      manualReviewAction: '人工举措',
      manualReviewOptimization: '人工优化',
      establishedAction: '确立举措',
      actionId: 'act-1',
      actionSchedule: '2026-07-01',
      rootCauseReview: '人工根因排查',
      sourceColumns: { 问题原因: '列根因' },
    })
    expect(getManualTagFields(cleared)).toEqual([])
    expect(cleared.manualReviewRootCause).toBe('')
    expect(cleared.manualReviewSolution).toBe('')
    expect(cleared.manualReviewAction).toBe('')
    expect(cleared.manualReviewOptimization).toBe('')
    expect(cleared.establishedAction).toBe('')
    expect(cleared.actionId).toBe('')
    expect(cleared.actionSchedule).toBe('')
    expect(cleared.rootCauseReview).toBe('列根因')
  })

  it('preserveManualTags skips restore when stale manualTagFields but LLM wrote llm source', () => {
    const original = {
      ...base,
      manualTagFields: ['customerRequest'],
      customerRequest: '旧请求',
      customerRequestSource: 'rule',
      painPoint: '旧痛点',
      painPointSource: 'rule',
    }
    const processed = {
      ...original,
      customerRequest: 'LLM 请求',
      customerRequestSource: 'llm',
      painPoint: 'LLM 痛点',
      painPointSource: 'llm',
    }
    const kept = preserveManualTags(original, processed)
    expect(kept.customerRequest).toBe('LLM 请求')
    expect(kept.customerRequestSource).toBe('llm')
    expect(kept.painPoint).toBe('LLM 痛点')
    expect(kept.painPointSource).toBe('llm')
  })

  it('preserveManualTags still restores manual/import analysis fields', () => {
    const original = {
      ...base,
      manualTagFields: ['customerRequest', 'painPoint'],
      customerRequest: '人工请求',
      customerRequestSource: 'manual',
      painPoint: '人工痛点',
      painPointSource: 'import',
    }
    const processed = {
      ...original,
      customerRequest: 'LLM 请求',
      customerRequestSource: 'llm',
      painPoint: 'LLM 痛点',
      painPointSource: 'llm',
    }
    const kept = preserveManualTags(original, processed)
    expect(kept.customerRequest).toBe('人工请求')
    expect(kept.customerRequestSource).toBe('manual')
    expect(kept.painPoint).toBe('人工痛点')
    expect(kept.painPointSource).toBe('import')
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
