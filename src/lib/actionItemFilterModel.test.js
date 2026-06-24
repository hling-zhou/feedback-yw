import { describe, expect, it } from 'vitest'
import {
  actionItemFiltersToListQuery,
  countActiveActionItemFilters,
  createEmptyActionItemFilters,
  formatActionItemFilterChipLabel,
  listActiveActionItemFilterChipKeys,
} from './actionItemFilterModel.js'
import {
  buildActionItemFilterPatchFromDraft,
  isActionItemFilterDraftValid,
} from './actionItemFilterEditors.js'

describe('actionItemFilterModel', () => {
  it('lists active chip keys and formats labels', () => {
    const values = {
      ...createEmptyActionItemFilters(),
      productKeys: ['vpc', 'eip'],
      statuses: ['pending_evaluation'],
      ticketId: 'T-001',
      linkedDataSources: ['complaint_ticket', 'consultation_ticket'],
      problemType: '故障',
      journeyL1: '使用',
    }
    expect(listActiveActionItemFilterChipKeys(values)).toEqual([
      'ticketId',
      'linkedDataSources',
      'productKeys',
      'statuses',
      'problemType',
      'journeyL1',
    ])
    expect(countActiveActionItemFilters(values)).toBe(6)
    expect(
      formatActionItemFilterChipLabel('productKeys', values, {
        productNameByKey: new Map([
          ['vpc', 'VPC'],
          ['eip', 'EIP'],
        ]),
      }),
    ).toBe('2 个')
    expect(formatActionItemFilterChipLabel('statuses', values)).toBe('待评估')
    expect(formatActionItemFilterChipLabel('ticketId', values)).toBe('T-001')
    expect(formatActionItemFilterChipLabel('linkedDataSources', values)).toBe('2 个')
    expect(formatActionItemFilterChipLabel('problemType', values)).toBe('故障')
    expect(formatActionItemFilterChipLabel('journeyL1', values)).toBe('使用')
    expect(actionItemFiltersToListQuery(values)).toEqual({
      productKeys: 'vpc,eip',
      statuses: 'pending_evaluation',
      ticketId: 'T-001',
      linkedDataSources: 'complaint_ticket,consultation_ticket',
      problemType: '故障',
      journeyL1: '使用',
    })
  })

  it('formats single linkedDataSources chip label', () => {
    const values = {
      ...createEmptyActionItemFilters(),
      linkedDataSources: ['post_use_rating'],
    }
    expect(formatActionItemFilterChipLabel('linkedDataSources', values)).toBe('用后即评')
  })
})

describe('actionItemFilterEditors', () => {
  it('validates and builds linkedDataSources draft', () => {
    expect(isActionItemFilterDraftValid('linkedDataSources', ['complaint_ticket'])).toBe(true)
    expect(isActionItemFilterDraftValid('linkedDataSources', [])).toBe(false)
    expect(
      buildActionItemFilterPatchFromDraft('linkedDataSources', [
        'complaint_ticket',
        'invalid_source',
        'consultation_ticket',
      ]),
    ).toEqual({
      linkedDataSources: ['complaint_ticket', 'consultation_ticket'],
    })
  })
})
