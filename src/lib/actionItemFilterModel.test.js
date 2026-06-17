import { describe, expect, it } from 'vitest'
import {
  actionItemFiltersToListQuery,
  countActiveActionItemFilters,
  createEmptyActionItemFilters,
  formatActionItemFilterChipLabel,
  listActiveActionItemFilterChipKeys,
} from './actionItemFilterModel.js'

describe('actionItemFilterModel', () => {
  it('lists active chip keys and formats labels', () => {
    const values = {
      ...createEmptyActionItemFilters(),
      productKeys: ['vpc', 'eip'],
      statuses: ['pending_evaluation'],
      ticketId: 'T-001',
      problemType: '故障',
      journeyL1: '使用',
    }
    expect(listActiveActionItemFilterChipKeys(values)).toEqual([
      'ticketId',
      'productKeys',
      'statuses',
      'problemType',
      'journeyL1',
    ])
    expect(countActiveActionItemFilters(values)).toBe(5)
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
    expect(formatActionItemFilterChipLabel('problemType', values)).toBe('故障')
    expect(formatActionItemFilterChipLabel('journeyL1', values)).toBe('使用')
    expect(actionItemFiltersToListQuery(values)).toEqual({
      productKeys: 'vpc,eip',
      statuses: 'pending_evaluation',
      ticketId: 'T-001',
      problemType: '故障',
      journeyL1: '使用',
    })
  })
})
