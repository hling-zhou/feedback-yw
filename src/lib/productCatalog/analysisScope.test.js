import { describe, expect, it } from 'vitest'
import {
  getAnalysisEnabledProducts,
  isAnalysisEnabledProduct,
  scopeTopicAnalysisRecords,
} from './analysisScope.js'
import { resolveCatalogProduct } from './resolveCatalogProduct.js'

const catalog = [
  {
    key: 'eip',
    name: '弹性公网IP',
    enabled: true,
    analysisPostUseRating: true,
    specs: [{ name: '弹性公网IP-移动IP', match: ['弹性公网IP-移动IP'] }],
  },
  {
    key: 'ticket_only',
    name: '仅工单产品',
    enabled: true,
    analysisPostUseRating: false,
    specs: [{ name: '仅工单规格' }],
  },
  {
    key: 'post_use_only',
    name: '仅用后即评产品',
    enabled: false,
    analysisPostUseRating: true,
    specs: [{ name: '仅评规格' }],
  },
  {
    key: 'off',
    name: '未启用产品',
    enabled: false,
    analysisPostUseRating: false,
    specs: [{ name: '未启用规格' }],
  },
]

describe('topic analysis product scope', () => {
  it('treats either analysis switch as in-scope', () => {
    expect(isAnalysisEnabledProduct(catalog[0])).toBe(true)
    expect(isAnalysisEnabledProduct(catalog[1])).toBe(true)
    expect(isAnalysisEnabledProduct(catalog[2])).toBe(true)
    expect(isAnalysisEnabledProduct(catalog[3])).toBe(false)
    expect(getAnalysisEnabledProducts(catalog).map((item) => item.key)).toEqual([
      'eip',
      'ticket_only',
      'post_use_only',
    ])
  })

  it('resolves product key, name, spec and alias', () => {
    expect(resolveCatalogProduct('弹性公网IP', catalog)?.key).toBe('eip')
    expect(resolveCatalogProduct({ productKey: 'eip' }, catalog)?.name).toBe('弹性公网IP')
    expect(resolveCatalogProduct({ productSpec: '弹性公网IP-移动IP' }, catalog)?.key).toBe('eip')
    expect(resolveCatalogProduct({ productName: '未启用产品' }, catalog)?.key).toBe('off')
    expect(resolveCatalogProduct({ productName: '未知云产品' }, catalog)).toBe(null)
    expect(resolveCatalogProduct({ id: 'no-product' }, catalog)).toBe(null)
  })

  it('keeps union products, drops disabled/unknown, and canonicalizes names', () => {
    const records = scopeTopicAnalysisRecords(
      [
        { id: '1', productName: '弹性公网IP-移动IP' },
        { id: '2', product: '仅工单产品' },
        { id: '3', productKey: 'post_use_only', productName: '仅用后即评产品' },
        { id: '4', productName: '未启用产品' },
        { id: '5', productName: '原始数据中的其他产品' },
        { id: '6' },
      ],
      catalog,
    )
    expect(records.map((row) => row.id)).toEqual(['1', '2', '3'])
    expect(records[0]).toMatchObject({ productKey: 'eip', product: '弹性公网IP', productName: '弹性公网IP' })
  })
})
