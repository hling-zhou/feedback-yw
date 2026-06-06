import { describe, expect, it } from 'vitest'
import {
  applyWorkbenchScopeFilterPatch,
  clearAllWorkbenchScopeFilters,
  countActiveWorkbenchScopeFilters,
  createEmptyWorkbenchScopeFilters,
  listActiveWorkbenchScopeFilterChipKeys,
  WORKBENCH_ANALYSIS_SCOPE_KEYS,
} from './workbenchScopeFilterModel.js'

describe('workbenchScopeFilterModel', () => {
  it('clears dependent scope fields when source or product changes', () => {
    const base = {
      ...createEmptyWorkbenchScopeFilters(),
      dataSource: 'complaint_ticket',
      product: '云主机',
      resourcePool: '华东',
    }
    expect(
      applyWorkbenchScopeFilterPatch('dataSource', { dataSource: 'consultation_ticket' }, base),
    ).toEqual({
      dataSource: 'consultation_ticket',
      product: '',
      resourcePool: '',
      complaintCauseL1: '',
    })
    expect(applyWorkbenchScopeFilterPatch('product', { product: 'VPC' }, base)).toEqual({
      dataSource: 'complaint_ticket',
      product: 'VPC',
      resourcePool: '',
      complaintCauseL1: '',
    })
  })

  it('lists active analysis scope chips', () => {
    const values = {
      ...createEmptyWorkbenchScopeFilters(),
      dataSource: 'complaint_ticket',
      product: '云主机',
    }
    expect(listActiveWorkbenchScopeFilterChipKeys(values, WORKBENCH_ANALYSIS_SCOPE_KEYS)).toEqual([
      'dataSource',
      'product',
    ])
    expect(countActiveWorkbenchScopeFilters(values, WORKBENCH_ANALYSIS_SCOPE_KEYS)).toBe(2)
    expect(clearAllWorkbenchScopeFilters(WORKBENCH_ANALYSIS_SCOPE_KEYS)).toEqual(
      createEmptyWorkbenchScopeFilters(),
    )
  })
})
