import { describe, expect, it } from 'vitest'
import { migrateProductCatalogKeys } from './migrateProductCatalogKeys.js'
import { countCatalogRefsToTaxonomyKey } from './productCenterSync.js'

describe('migrateProductCatalogKeys', () => {
  it('migrates ecc and SLB to dc and slb', () => {
    const { products, changed } = migrateProductCatalogKeys([
      { key: 'ecc', name: '云专线', enabled: true, taxonomyKey: 'ecc', specs: [] },
      { key: 'SLB', name: '弹性负载均衡', enabled: true, taxonomyKey: 'SLB', specs: [] },
    ])
    expect(changed).toBe(true)
    expect(products.map((p) => p.key)).toEqual(['dc', 'slb'])
    expect(products[0].taxonomyKey).toBe('dc')
    expect(products[1].taxonomyKey).toBe('slb')
  })

  it('merges duplicate legacy and canonical entries', () => {
    const { products } = migrateProductCatalogKeys([
      { key: 'ecc', name: '云专线旧', enabled: true, taxonomyKey: 'ecc', specs: [{ name: 'A' }] },
      { key: 'dc', name: '云专线', enabled: true, taxonomyKey: 'dc', specs: [{ name: 'B' }] },
    ])
    expect(products).toHaveLength(1)
    expect(products[0].key).toBe('dc')
    expect(products[0].specs?.map((s) => s.name)).toEqual(['A', 'B'])
  })
})

describe('countCatalogRefsToTaxonomyKey', () => {
  it('matches catalog products by canonical taxonomy key', () => {
    const catalog = [
      { key: 'ecc', name: '云专线', enabled: true, taxonomyKey: 'ecc', specs: [] },
    ]
    expect(countCatalogRefsToTaxonomyKey(catalog, 'dc')).toBe(1)
    expect(countCatalogRefsToTaxonomyKey(catalog, 'slb')).toBe(0)
  })
})
