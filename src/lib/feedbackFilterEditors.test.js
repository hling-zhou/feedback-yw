import { describe, expect, it } from 'vitest'
import { createEmptyFeedbackFilters } from './feedbackFilterModel.js'
import { buildFilterPatchFromDraft, listEnumOptionsForFilterKey } from './feedbackFilterEditors.js'

describe('feedbackFilterEditors data source scope', () => {
  it('limits ticket lane sources to complaint and consultation', () => {
    const options = listEnumOptionsForFilterKey(
      'dataSource',
      createEmptyFeedbackFilters(),
      { dataSourceTypes: ['complaint_ticket', 'consultation_ticket'] },
      true,
    )
    expect(options.map((item) => item.value)).toEqual([
      'complaint_ticket',
      'consultation_ticket',
    ])
  })

  it('limits post-use lane source to post-use rating', () => {
    const options = listEnumOptionsForFilterKey(
      'dataSource',
      createEmptyFeedbackFilters(),
      { dataSourceTypes: ['post_use_rating'] },
      false,
    )
    expect(options).toEqual([{ label: '用后即评', value: 'post_use_rating' }])
  })

  it('normalizes customer name multi-select drafts', () => {
    expect(
      buildFilterPatchFromDraft('customerNames', [' 客户A ', '客户B', '客户A', '']),
    ).toEqual({
      customerNames: ['客户A', '客户B'],
    })
  })

  it('lists customer name options from the provided catalog', () => {
    const options = listEnumOptionsForFilterKey(
      'customerNames',
      createEmptyFeedbackFilters(),
      { customerNameOptions: [{ label: '客户甲', value: '客户甲' }] },
      true,
    )
    expect(options).toEqual([{ label: '客户甲', value: '客户甲' }])
  })
})
