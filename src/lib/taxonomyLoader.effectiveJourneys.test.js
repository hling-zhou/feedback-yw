import { describe, it, expect, beforeEach } from 'vitest'
import {
  applyManagedTaxonomySnapshot,
  effectiveJourneysForProduct,
  getProductByKey,
  getNodeMapsForProduct,
  hasRequestNodeMaps,
} from './taxonomyLoader.js'
import { DC_USER_JOURNEY } from './journeys/dcJourney.js'
import { SLB_USER_JOURNEY } from './journeys/slbJourney.js'
import { VPC_USER_JOURNEY } from './journeys/vpcJourney.js'
import { MONITOR_USER_JOURNEY } from './journeys/monitorJourney.js'
import { CC_USER_JOURNEY } from './journeys/ccJourney.js'
import { NAT_USER_JOURNEY } from './journeys/natJourney.js'
import { VPN_USER_JOURNEY } from './journeys/vpnJourney.js'

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

  it('injects vpc request node maps when snapshot omits nodeMaps', () => {
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
    expect(hasRequestNodeMaps('vpc')).toBe(true)
    const maps = getNodeMapsForProduct('vpc')
    expect(maps.serviceMap['产品使用问题']).toBe('operate')
    expect(maps.issueMap['VPC业务变更']?.l2).toBe('provision-subnet-change')
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

  it('exposes configured monitor journeys', () => {
    applyManagedTaxonomySnapshot({
      products: {
        monitor: {
          key: 'monitor',
          name: '云监控',
          match: ['云监控'],
          journeys: structuredClone(MONITOR_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    const monitor = getProductByKey('monitor')
    expect(monitor.journeys).toHaveLength(MONITOR_USER_JOURNEY.length)
    expect(monitor.journeys.some((j) => j.id === 'access')).toBe(true)
    expect(monitor.journeys.some((j) => j.id === 'operate')).toBe(true)
  })

  it('injects monitor request node maps when snapshot omits nodeMaps', () => {
    applyManagedTaxonomySnapshot({
      products: {
        monitor: {
          key: 'monitor',
          name: '云监控',
          match: ['云监控'],
          journeys: structuredClone(MONITOR_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    expect(hasRequestNodeMaps('monitor')).toBe(true)
    const maps = getNodeMapsForProduct('monitor')
    expect(maps.serviceMap['报障与恢复']).toBe('operate')
    expect(maps.issueMap['监控数据不准确']?.l2).toBe('operate-data')
  })

  it('exposes configured cc journeys for 云组网', () => {
    applyManagedTaxonomySnapshot({
      products: {
        cc: {
          key: 'cc',
          name: '云组网',
          match: ['云组网'],
          journeys: structuredClone(CC_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    const cc = getProductByKey('cc')
    expect(cc.journeys).toHaveLength(CC_USER_JOURNEY.length)
    expect(cc.journeys.some((j) => j.id === 'provision')).toBe(true)
    expect(cc.journeys.some((j) => j.id === 'operate')).toBe(true)
  })

  it('injects cc request node maps when snapshot omits nodeMaps', () => {
    applyManagedTaxonomySnapshot({
      products: {
        cc: {
          key: 'cc',
          name: '云组网',
          match: ['云组网'],
          journeys: structuredClone(CC_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    expect(hasRequestNodeMaps('cc')).toBe(true)
    const maps = getNodeMapsForProduct('cc')
    expect(maps.serviceMap['报障与恢复']).toBe('operate')
    expect(maps.issueMap['订购成功后无法互访']?.l2).toBe('provision-order')
  })

  it('exposes configured nat journeys for NAT网关', () => {
    applyManagedTaxonomySnapshot({
      products: {
        nat: {
          key: 'nat',
          name: 'NAT网关',
          match: ['NAT网关'],
          journeys: structuredClone(NAT_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    const nat = getProductByKey('nat')
    expect(nat.journeys).toHaveLength(NAT_USER_JOURNEY.length)
    expect(nat.journeys.some((j) => j.id === 'provision')).toBe(true)
    expect(nat.journeys.some((j) => j.id === 'operate')).toBe(true)
  })

  it('injects nat request node maps when snapshot omits nodeMaps', () => {
    applyManagedTaxonomySnapshot({
      products: {
        nat: {
          key: 'nat',
          name: 'NAT网关',
          match: ['NAT网关'],
          journeys: structuredClone(NAT_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    expect(hasRequestNodeMaps('nat')).toBe(true)
    const maps = getNodeMapsForProduct('nat')
    expect(maps.serviceMap['报障与恢复']).toBe('operate')
    expect(maps.issueMap['SNAT功能问题']?.l2).toBe('operate-snat')
    expect(maps.issueMap['DNAT规则管理异常']?.l2).toBe('operate-dnat')
  })

  it('exposes configured vpn journeys for 融合VPN', () => {
    applyManagedTaxonomySnapshot({
      products: {
        vpn: {
          key: 'vpn',
          name: '融合VPN',
          match: ['融合VPN'],
          journeys: structuredClone(VPN_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    const vpn = getProductByKey('vpn')
    expect(vpn.journeys).toHaveLength(VPN_USER_JOURNEY.length)
    expect(vpn.journeys.some((j) => j.id === 'configure')).toBe(true)
    expect(vpn.journeys.some((j) => j.id === 'operate')).toBe(true)
  })

  it('injects vpn request node maps when snapshot omits nodeMaps', () => {
    applyManagedTaxonomySnapshot({
      products: {
        vpn: {
          key: 'vpn',
          name: '融合VPN',
          match: ['融合VPN'],
          journeys: structuredClone(VPN_USER_JOURNEY),
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    })
    expect(hasRequestNodeMaps('vpn')).toBe(true)
    const maps = getNodeMapsForProduct('vpn')
    expect(maps.serviceMap['报障与恢复']).toBe('operate')
    expect(maps.issueMap['IPSecVPN产品使用(咨询)']?.l2).toBe('configure-ipsec')
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
