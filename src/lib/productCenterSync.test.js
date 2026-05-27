import { describe, it, expect } from 'vitest'
import {
  ensureTaxonomyProduct,
  syncCatalogProductsToTaxonomy,
  countCatalogRefsToTaxonomyKey,
} from './productCenterSync.js'

describe('productCenterSync', () => {
  it('ensureTaxonomyProduct adds product with empty journeys', () => {
    const snapshot = {
      products: {
        generic: {
          key: 'generic',
          name: '通用',
          match: [],
          journeys: [{ id: 'a', label: 'A', children: [{ id: 'b', label: 'B' }] }],
        },
      },
      sharedProblemTypes: [],
    }
    ensureTaxonomyProduct(snapshot, {
      key: 'ecs',
      name: '云主机',
    })
    expect(snapshot.products.ecs.journeys).toEqual([])
    expect(snapshot.products.ecs.catalogProvisioned).toBe(true)
    expect(snapshot.products.ecs.journeyConfigured).toBe(false)
  })

  it('syncCatalogProductsToTaxonomy clears generic-cloned journeys on existing template', () => {
    const genericJourneys = [
      { id: 'consult', label: '咨询了解', children: [{ id: 'c1', label: '产品咨询' }] },
    ]
    const snapshot = {
      products: {
        generic: { key: 'generic', name: '通用', match: [], journeys: genericJourneys },
        foo: {
          key: 'foo',
          name: '旧',
          match: [],
          journeys: JSON.parse(JSON.stringify(genericJourneys)),
        },
      },
      sharedProblemTypes: [],
    }
    const catalog = [{ key: 'foo', name: '新产品', enabled: true, taxonomyKey: 'foo', specs: [] }]
    const next = syncCatalogProductsToTaxonomy(snapshot, catalog)
    expect(next.products.foo.journeys).toEqual([])
    expect(next.products.foo.journeyConfigured).toBe(false)
  })

  it('sync keeps user-configured journeys on product save', () => {
    const snapshot = {
      products: {
        generic: { key: 'generic', name: '通用', match: [], journeys: [] },
        foo: {
          key: 'foo',
          name: 'Foo',
          match: [],
          journeys: [{ id: 'custom', label: '自定义', children: [] }],
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    }
    const catalog = [{ key: 'foo', name: 'Foo', enabled: true, taxonomyKey: 'foo', specs: [] }]
    const next = syncCatalogProductsToTaxonomy(snapshot, catalog)
    expect(next.products.foo.journeys).toHaveLength(1)
    expect(next.products.foo.journeyConfigured).toBe(true)
  })

  it('syncCatalogProductsToTaxonomy creates missing template keys', () => {
    const snapshot = {
      products: { generic: { key: 'generic', name: '通用', match: [], journeys: [] } },
      sharedProblemTypes: [],
    }
    const catalog = [
      { key: 'ecs', name: '云主机', enabled: true, taxonomyKey: 'ecs', specs: [] },
      { key: 'eip', name: 'EIP', enabled: true, taxonomyKey: 'eip', specs: [] },
    ]
    const next = syncCatalogProductsToTaxonomy(snapshot, catalog)
    expect(next.products.ecs).toBeDefined()
    expect(next.products.eip).toBeDefined()
    expect(next.products.ecs.journeys).toEqual([])
    expect(next.products.eip.journeys).toEqual([])
  })

  it('syncCatalogProductsToTaxonomy updates existing template metadata', () => {
    const snapshot = {
      products: {
        generic: { key: 'generic', name: '通用', match: [], journeys: [] },
        ecs: { key: 'ecs', name: '旧名称', match: ['旧'], journeys: [{ id: 'a' }] },
      },
      sharedProblemTypes: [],
    }
    const catalog = [{ key: 'ecs', name: '云主机', enabled: true, taxonomyKey: 'ecs', specs: [] }]
    const next = syncCatalogProductsToTaxonomy(snapshot, catalog)
    expect(next.products.ecs.name).toBe('云主机')
    expect(next.products.ecs.match).toEqual(['云主机', 'ecs'])
    expect(next.products.ecs.journeys).toHaveLength(1)
  })

  it('syncCatalogProductsToTaxonomy removes unreferenced product templates', () => {
    const snapshot = {
      products: {
        generic: { key: 'generic', name: '通用', match: [], journeys: [] },
        ecs: { key: 'ecs', name: '云主机', match: [], journeys: [] },
        obs: { key: 'obs', name: '对象存储', match: [], journeys: [] },
      },
      sharedProblemTypes: [],
    }
    const catalog = [{ key: 'ecs', name: '云主机', enabled: true, taxonomyKey: 'ecs', specs: [] }]
    const next = syncCatalogProductsToTaxonomy(snapshot, catalog)
    expect(next.products.ecs).toBeDefined()
    expect(next.products.obs).toBeUndefined()
    expect(next.products.generic).toBeDefined()
  })

  it('syncCatalogProductsToTaxonomy injects builtin vpc journeys for new catalog product', () => {
    const snapshot = {
      products: { generic: { key: 'generic', name: '通用', match: [], journeys: [] } },
      sharedProblemTypes: [],
    }
    const catalog = [
      {
        key: 'vpc',
        name: '虚拟私有云',
        enabled: true,
        taxonomyKey: 'vpc',
        specs: [],
      },
    ]
    const next = syncCatalogProductsToTaxonomy(snapshot, catalog)
    expect(next.products.vpc.journeys.length).toBeGreaterThan(0)
    expect(next.products.vpc.journeyConfigured).toBe(true)
    const l2 = next.products.vpc.journeys.reduce(
      (n, j) => n + (j.children?.length || 0),
      0,
    )
    expect(l2).toBe(27)
  })

  it('countCatalogRefsToTaxonomyKey', () => {
    const catalog = [
      { key: 'ecs', taxonomyKey: 'ecs' },
      { key: 'x', taxonomyKey: 'generic' },
    ]
    expect(countCatalogRefsToTaxonomyKey(catalog, 'ecs')).toBe(1)
  })
})
