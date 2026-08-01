import { describe, expect, it } from 'vitest'
import { ensureTargetProductsInCatalog } from './ensureTargetProducts.js'
import { POST_USE_RATING_PRODUCT_NAMES } from './postUseRatingProducts.js'

describe('ensureTargetProductsInCatalog', () => {
  it('adds vpc when missing', () => {
    const { products, changed } = ensureTargetProductsInCatalog([
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        taxonomyKey: 'eip',
        acceptParentName: true,
        specs: [],
      },
    ])
    expect(changed).toBe(true)
    expect(products.some((p) => p.key === 'vpc')).toBe(true)
    expect(products.find((p) => p.key === 'vpc')?.specs?.[0]?.name).toBe('虚拟私有云')
  })

  it('backfills 用后即评 16 products and analysis flags', () => {
    const catalog = [
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        taxonomyKey: 'eip',
        acceptParentName: true,
        specs: [],
      },
      {
        key: 'dc',
        name: '云专线',
        enabled: true,
        taxonomyKey: 'dc',
        acceptParentName: true,
        specs: [],
      },
      {
        key: 'slb',
        name: '弹性负载均衡',
        enabled: true,
        taxonomyKey: 'slb',
        acceptParentName: true,
        specs: [],
      },
      {
        key: 'vpc',
        name: '虚拟私有云',
        enabled: true,
        taxonomyKey: 'vpc',
        acceptParentName: true,
        specs: [
          {
            name: '虚拟私有云',
            match: ['虚拟私有云', 'VPC', 'vpc', '专有网络', '私有网络'],
          },
        ],
      },
    ]
    const { products, changed } = ensureTargetProductsInCatalog(catalog)
    expect(changed).toBe(true)
    const names = new Set(
      products.filter((p) => p.analysisPostUseRating).map((p) => p.name),
    )
    for (const n of POST_USE_RATING_PRODUCT_NAMES) {
      expect(names.has(n)).toBe(true)
    }
    expect(products.find((p) => p.key === 'eip')?.analysisPostUseRating).toBe(true)
    expect(products.find((p) => p.key === 'eip')?.focusTracked).toBe(true)
    expect(products.find((p) => p.key === 'shared_bw')?.name).toBe('共享带宽')
  })

  it('is idempotent when seeds already applied', () => {
    const first = ensureTargetProductsInCatalog([])
    const second = ensureTargetProductsInCatalog(first.products)
    expect(second.changed).toBe(false)
  })
})
