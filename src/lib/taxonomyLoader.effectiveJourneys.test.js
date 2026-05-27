import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyManagedTaxonomySnapshot,
  effectiveJourneysForProduct,
  getProductByKey,
} from './taxonomyLoader.js'
import { DC_USER_JOURNEY } from './journeys/dcJourney.js'
import { SLB_USER_JOURNEY } from './journeys/slbJourney.js'
import { VPC_USER_JOURNEY } from './journeys/vpcJourney.js'

describe('effectiveJourneysForProduct', () => {
  beforeEach(() => {
    applyManagedTaxonomySnapshot({
      products: {
        generic: {
          key: 'generic',
          name: '通用',
          match: [],
          journeys: [
            {
              id: 'consult',
              label: '咨询了解',
              children: [{ id: 'c1', label: '产品咨询', keywords: [] }],
            },
          ],
        },
        yunzx: {
          key: 'yunzx',
          name: '云专线',
          match: ['云专线'],
          journeys: [
            {
              id: 'consult',
              label: '咨询了解',
              children: [{ id: 'c1', label: '产品咨询', keywords: [] }],
            },
          ],
          catalogProvisioned: true,
          journeyConfigured: false,
        },
      },
      sharedProblemTypes: [],
    })
  })

  it('strips generic-cloned journeys for unconfigured catalog product', () => {
    expect(effectiveJourneysForProduct(getProductByKey('yunzx'))).toEqual([])
    expect(getProductByKey('yunzx').journeys).toEqual([])
  })

  it('exposes configured dc journeys for 云专线', () => {
    applyManagedTaxonomySnapshot({
      products: {
        dc: {
          key: 'dc',
          name: '云专线',
          match: ['云专线'],
          journeys: structuredClone(DC_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    const dc = getProductByKey('dc')
    expect(dc.journeys).toHaveLength(DC_USER_JOURNEY.length)
    expect(dc.journeys.some((j) => j.id === 'provision')).toBe(true)
  })

  it('exposes configured vpc journeys', () => {
    applyManagedTaxonomySnapshot({
      products: {
        vpc: {
          key: 'vpc',
          name: '虚拟私有云',
          match: ['VPC'],
          journeys: structuredClone(VPC_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    const vpc = getProductByKey('vpc')
    expect(vpc.journeys).toHaveLength(VPC_USER_JOURNEY.length)
    expect(vpc.journeys.some((j) => j.id === 'provision')).toBe(true)
  })

  it('exposes configured slb journeys', () => {
    applyManagedTaxonomySnapshot({
      products: {
        slb: {
          key: 'slb',
          name: '弹性负载均衡',
          match: ['负载均衡'],
          journeys: structuredClone(SLB_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    const slb = getProductByKey('slb')
    expect(slb.journeys).toHaveLength(SLB_USER_JOURNEY.length)
    expect(slb.journeys.some((j) => j.id === 'provision')).toBe(true)
  })

  it('keeps journeys for configured product', () => {
    applyManagedTaxonomySnapshot({
      products: {
        generic: { key: 'generic', name: '通用', match: [], journeys: [] },
        custom: {
          key: 'custom',
          name: '自定义',
          match: [],
          journeys: [
            { id: 'a', label: '环节A', children: [{ id: 'b', label: '子B', keywords: [] }] },
          ],
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    expect(getProductByKey('custom').journeys).toHaveLength(1)
  })
})
