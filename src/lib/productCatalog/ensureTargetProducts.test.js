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

  it('respects deletedKeys - does not re-add deleted seed products', () => {
    const first = ensureTargetProductsInCatalog([])
    expect(first.products.some((p) => p.key === 'vpc')).toBe(true)

    const withoutVpc = first.products.filter((p) => p.key !== 'vpc')
    const second = ensureTargetProductsInCatalog(withoutVpc, {
      deletedKeys: ['vpc'],
    })
    expect(second.products.some((p) => p.key === 'vpc')).toBe(false)
  })

  it('respects deletedKeys - does not force-enable analysisPostUseRating', () => {
    const catalog = [
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        analysisPostUseRating: false,
        focusTracked: false,
        taxonomyKey: 'eip',
        acceptParentName: true,
        specs: [],
      },
    ]
    const result = ensureTargetProductsInCatalog(catalog, {
      deletedKeys: ['eip'],
    })
    const eip = result.products.find((p) => p.key === 'eip')
    expect(eip).toBeTruthy()
    expect(eip.analysisPostUseRating).toBe(false)
    expect(eip.focusTracked).toBe(false)
  })

  it('respects disabledAnalysisKeys - does not force-enable analysisPostUseRating', () => {
    const catalog = [
      {
        key: 'vpn',
        name: '融合VPN',
        enabled: true,
        analysisPostUseRating: false,
        focusTracked: false,
        taxonomyKey: 'vpn',
        acceptParentName: true,
        specs: [],
      },
    ]
    const result = ensureTargetProductsInCatalog(catalog, {
      disabledAnalysisKeys: ['vpn'],
    })
    const vpn = result.products.find((p) => p.key === 'vpn')
    expect(vpn).toBeTruthy()
    expect(vpn.analysisPostUseRating).toBe(false)
    expect(vpn.focusTracked).toBe(false)
  })

  it('respects disabledAnalysisKeys - re-enabling removes from disabledAnalysisKeys', () => {
    const catalog = [
      {
        key: 'vpn',
        name: '融合VPN',
        enabled: true,
        analysisPostUseRating: true,
        focusTracked: false,
        taxonomyKey: 'vpn',
        acceptParentName: true,
        specs: [],
      },
    ]
    // vpn not in disabledAnalysisKeys → seed forces focusTracked true
    const result = ensureTargetProductsInCatalog(catalog, {
      disabledAnalysisKeys: [],
    })
    const vpn = result.products.find((p) => p.key === 'vpn')
    expect(vpn.analysisPostUseRating).toBe(true)
    expect(vpn.focusTracked).toBe(true)
  })
})
