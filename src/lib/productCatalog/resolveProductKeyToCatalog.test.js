import { describe, it, expect, beforeEach } from 'vitest'
import { applyCatalogProducts } from '../productCatalogLoader.js'
import { resolveProductKeyToCatalog } from './resolveProductKeyToCatalog.js'

// 测试目录（11-18 归一层单测）：覆盖 enabled/disabled、规格别名、大写 key 三形态
const TEST_CATALOG = [
  { key: 'vpc', name: '虚拟私有云', enabled: true, taxonomyKey: 'vpc', specs: [{ name: '对等连接', match: ['对等连接', 'VPC对等连接'] }] },
  { key: 'dc', name: '云专线', enabled: true, taxonomyKey: 'dc', specs: [] },
  // disabled 产品（如用后即评线 NAT网关）：归一层必须同样能解析
  { key: 'nat', name: 'NAT网关', enabled: false, taxonomyKey: 'nat', specs: [{ name: 'NAT 网关', match: ['nat网关'] }] },
  { key: 'shared_bw', name: '共享带宽', enabled: false, taxonomyKey: 'eip', specs: [] },
  { key: 'CloudDNS', name: '云解析', enabled: true, taxonomyKey: 'CloudDNS', specs: [] },
]

beforeEach(() => {
  applyCatalogProducts(TEST_CATALOG, { source: 'managed' })
})

describe('resolveProductKeyToCatalog（产品标识归一层）', () => {
  it('目录 key 恒等返回（不破坏已正确形态的调用方）', () => {
    expect(resolveProductKeyToCatalog('vpc')).toBe('vpc')
    expect(resolveProductKeyToCatalog('dc')).toBe('dc')
    // 大小写形态不同的 key（shared_bw 种子里 eip 线的别名场景）按目录 key 精确对照
    expect(resolveProductKeyToCatalog('CloudDNS')).toBe('CloudDNS')
  })

  it('目录中文名 → 目录 key', () => {
    expect(resolveProductKeyToCatalog('虚拟私有云')).toBe('vpc')
    expect(resolveProductKeyToCatalog('云专线')).toBe('dc')
    expect(resolveProductKeyToCatalog('共享带宽')).toBe('shared_bw')
  })

  it('规格名/别名 → 父产品 key', () => {
    expect(resolveProductKeyToCatalog('对等连接')).toBe('vpc')
    expect(resolveProductKeyToCatalog('VPC对等连接')).toBe('vpc')
    expect(resolveProductKeyToCatalog('nat网关')).toBe('nat')
  })

  it('disabled 产品同样解析（含 disabled 的用后即评产品）', () => {
    expect(resolveProductKeyToCatalog('NAT网关')).toBe('nat')
    expect(resolveProductKeyToCatalog('NAT 网关')).toBe('nat')
  })

  it('未命中目录原样返回（未入目录的自定义产品兜底）', () => {
    expect(resolveProductKeyToCatalog('自定义神秘产品')).toBe('自定义神秘产品')
    expect(resolveProductKeyToCatalog('unknown_key')).toBe('unknown_key')
  })

  it('空值返回空串（不猜测）', () => {
    expect(resolveProductKeyToCatalog('')).toBe('')
    expect(resolveProductKeyToCatalog(null)).toBe('')
    expect(resolveProductKeyToCatalog(undefined)).toBe('')
    expect(resolveProductKeyToCatalog('   ')).toBe('')
  })
})
