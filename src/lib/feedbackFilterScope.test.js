import { describe, expect, it } from 'vitest'
import { createEmptyFeedbackFilters, applyFeedbackFilterPatch } from './feedbackFilterModel.js'
import { FEEDBACK_LANE_POST_USE, FEEDBACK_LANE_TICKETS } from '../domain/postUseRatingImport.js'
import {
  cascadeClearProductDependentFilters,
  libraryFilterOptionRecords,
  listFeedbackLibraryProducts,
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

describe('listFeedbackLibraryProducts', () => {
  const catalog = [
    { name: '弹性公网IP', enabled: true, analysisPostUseRating: true },
    { name: '虚拟私有云', enabled: true, analysisPostUseRating: true },
    { name: '云硬盘 EBS', enabled: false, analysisPostUseRating: true },
    { name: '云主机 ECS', enabled: false, analysisPostUseRating: false },
  ]

  const mixed = [
    { product: '弹性公网IP', dataSourceType: 'complaint_ticket' },
    { product: '弹性公网IP', dataSourceType: 'complaint_ticket' },
    { product: '虚拟私有云', dataSourceType: 'consultation_ticket' },
    { product: '云硬盘 EBS', dataSourceType: 'post_use_rating', productName: '云硬盘 EBS' },
    { product: '云硬盘 EBS', dataSourceType: 'post_use_rating' },
    { product: '云主机 ECS', dataSourceType: 'post_use_rating' },
    { product: '云电脑（办公型）', dataSourceType: 'post_use_rating' },
  ]

  it('keeps ticket-lane options to catalog products with ticket analysis enabled', () => {
    const records = libraryFilterOptionRecords(mixed, FEEDBACK_LANE_TICKETS)
    const options = listFeedbackLibraryProducts(records, catalog, FEEDBACK_LANE_TICKETS)
    expect(options.map((item) => ({ name: item.name, count: item.count }))).toEqual([
      { name: '弹性公网IP', count: 2 },
      { name: '虚拟私有云', count: 1 },
    ])
  })

  it('keeps post-use-lane options to catalog products with post-use analysis enabled', () => {
    const records = libraryFilterOptionRecords(mixed, FEEDBACK_LANE_POST_USE)
    const options = listFeedbackLibraryProducts(records, catalog, FEEDBACK_LANE_POST_USE)
    expect(options.map((item) => ({ name: item.name, count: item.count }))).toEqual([
      { name: '云硬盘 EBS', count: 2 },
    ])
  })

  it('falls back to record products when catalog is empty', () => {
    const records = libraryFilterOptionRecords(mixed, FEEDBACK_LANE_TICKETS)
    expect(listFeedbackLibraryProducts(records, [], FEEDBACK_LANE_TICKETS).map((item) => item.name)).toEqual([
      '弹性公网IP',
      '虚拟私有云',
    ])
  })
})
