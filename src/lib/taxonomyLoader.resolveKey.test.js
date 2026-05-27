import { describe, it, expect } from 'vitest'
import { resolveTaxonomyKey, getAllProducts } from './taxonomyLoader.js'

describe('resolveTaxonomyKey', () => {
  it('honors catalog productKey even when not in managed taxonomy cache', () => {
    expect(getAllProducts().__no_such_product__).toBeUndefined()
    expect(resolveTaxonomyKey('云专线', 'dc')).toBe('dc')
    expect(resolveTaxonomyKey('云专线', 'yunzhuanxian')).toBe('dc')
    expect(resolveTaxonomyKey('弹性负载均衡', 'slb')).toBe('slb')
    expect(resolveTaxonomyKey('弹性负载均衡', 'SLB')).toBe('slb')
  })

  it('resolves 云专线 by match to dc', () => {
    expect(resolveTaxonomyKey('云专线', undefined)).toBe('dc')
  })

  it('resolves 弹性负载均衡 by match to slb', () => {
    expect(resolveTaxonomyKey('弹性负载均衡', undefined)).toBe('slb')
  })
})
