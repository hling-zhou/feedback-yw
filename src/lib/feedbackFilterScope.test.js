import { describe, expect, it } from 'vitest'
import { createEmptyFeedbackFilters, applyFeedbackFilterPatch } from './feedbackFilterModel.js'
import {
  cascadeClearProductDependentFilters,
  scopeFeedbacksByProduct,
} from './feedbackFilterScope.js'

describe('feedbackFilterScope', () => {
  const feedbacks = [
    { id: '1', product: 'ECS', journeyL1: '开通', problemType: '性能', requestScene: '报障' },
    { id: '2', product: 'RDS', journeyL1: '运维', problemType: '可用性', requestScene: '咨询' },
    { id: '3', product: '', journeyL1: '开通', problemType: '性能', requestScene: '报障' },
  ]

  it('scopes feedbacks by product including unlabeled bucket', () => {
    expect(scopeFeedbacksByProduct(feedbacks, 'ECS')).toHaveLength(1)
    expect(scopeFeedbacksByProduct(feedbacks, '未标注产品')).toHaveLength(1)
    expect(scopeFeedbacksByProduct(feedbacks, '')).toHaveLength(3)
  })

  it('clears product-dependent filters when switching product', () => {
    const current = {
      ...createEmptyFeedbackFilters(),
      product: 'ECS',
      journeyL1: '开通',
      problemType: '性能',
      requestScene: '报障',
      resourcePool: '默认池',
    }
    const nextProduct = applyFeedbackFilterPatch('product', { product: 'RDS' }, current)
    const scoped = scopeFeedbacksByProduct(feedbacks, 'RDS')
    const next = cascadeClearProductDependentFilters(nextProduct, scoped)
    expect(next.journeyL1).toBe('')
    expect(next.resourcePool).toBe('')
    expect(next.problemType).toBe('')
    expect(next.requestScene).toBe('')
  })
})
