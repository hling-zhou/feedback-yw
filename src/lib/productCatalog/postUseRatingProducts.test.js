import { describe, expect, it } from 'vitest'
import {
  getPostUseRatingProductNames,
  resolvePostUseRatingProduct,
  scopePostUseRatingRecords,
} from './postUseRatingProducts.js'

const catalog = [
  {
    key: 'enabled',
    name: '启用产品',
    analysisPostUseRating: true,
    specs: [{ name: '标准规格', match: ['规格别名'] }],
  },
  {
    key: 'disabled',
    name: '未启用产品',
    analysisPostUseRating: false,
    specs: [{ name: '未启用规格' }],
  },
]

describe('post-use rating product scope', () => {
  it('uses only products explicitly enabled for post-use analysis', () => {
    expect(getPostUseRatingProductNames(catalog)).toEqual(['启用产品'])
    expect(getPostUseRatingProductNames([{ ...catalog[0], analysisPostUseRating: false }])).toEqual([])
  })

  it('resolves product names, product keys, specification names, and aliases', () => {
    expect(resolvePostUseRatingProduct('启用产品', catalog)?.key).toBe('enabled')
    expect(resolvePostUseRatingProduct({ productKey: 'enabled' }, catalog)?.name).toBe('启用产品')
    expect(resolvePostUseRatingProduct({ productSpec: '标准规格' }, catalog)?.name).toBe('启用产品')
    expect(resolvePostUseRatingProduct({ productName: '规格别名' }, catalog)?.name).toBe('启用产品')
  })

  it('excludes imported products outside the enabled scope and canonicalizes matches', () => {
    const records = scopePostUseRatingRecords(
      [
        { id: '1', productName: '规格别名' },
        { id: '2', productName: '未启用产品' },
        { id: '3', productName: '原始数据中的其他产品' },
      ],
      catalog,
    )
    expect(records).toEqual([
      { id: '1', productKey: 'enabled', product: '启用产品', productName: '启用产品' },
    ])
  })
})
