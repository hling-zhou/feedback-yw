import { describe, expect, it } from 'vitest'
import { ensureTargetProductsInCatalog } from './ensureTargetProducts.js'

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

  it('does not change catalog when target products already present', () => {
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
    expect(changed).toBe(false)
    expect(products.filter((p) => p.key === 'vpc')).toHaveLength(1)
  })
})
