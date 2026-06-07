import { describe, expect, it } from 'vitest'
import { isFeedbackDrawerFormDirty } from './feedbackDrawerDirty.js'

const baseRecord = {
  id: '1',
  rawText: 't',
  customerQuote: 't',
  note: '',
  requestScene: '咨询',
  problemType: '配额与权限申请',
  journeyL1: '产品订改续',
  journeyL2: '权限及配额限制',
  sentiment: 'neutral',
  urgencyLevel: 'none',
  themes: ['权限及配额限制'],
  problemSummary: '',
  solutionSummary: '',
  rootCause: '',
  optimizationSuggestion: '',
  status: 'open',
  importedAt: '2026-01-01',
  customerRequest: '',
  painPoint: '',
}

const baseForm = {
  note: '',
  sentiment: 'neutral',
  urgencyLevel: 'none',
  requestScene: '咨询',
  problemType: '配额与权限申请',
  journeyL1: '产品订改续',
  journeyL2: '权限及配额限制',
  customerRequest: '',
  painPoint: '',
  productGroupOptimization: '',
  designerOptimization: '',
  establishedAction: '',
  establishedActionDetail: '',
  actionSchedule: '',
  actionId: '',
  rootCauseReview: '',
  complaintCauseL2Review: '',
  complaintCauseL3Review: '',
}

describe('isFeedbackDrawerFormDirty', () => {
  it('returns false when form matches stored record', () => {
    expect(isFeedbackDrawerFormDirty(baseRecord, baseForm)).toBe(false)
  })

  it('returns true when editable field changed', () => {
    expect(isFeedbackDrawerFormDirty(baseRecord, { ...baseForm, note: '新备注' })).toBe(true)
    expect(
      isFeedbackDrawerFormDirty(baseRecord, { ...baseForm, complaintCauseL2Review: '复核二级' }),
    ).toBe(true)
  })
})
