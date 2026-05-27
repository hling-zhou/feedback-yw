import { describe, it, expect } from 'vitest'
import { resolveProductFromSpec } from '../productCatalog.js'
import { loadProductCatalogConfig } from '../productCatalogLoader.js'
import { mergeSharedBandwidthIntoEipCatalog } from './sharedBandwidthSpec.js'

describe('shared bandwidth as EIP spec', () => {
  it('mergeSharedBandwidthIntoEipCatalog removes standalone product and adds spec', () => {
    const { products, changed } = mergeSharedBandwidthIntoEipCatalog([
      {
        key: 'eip',
        name: '弹性公网IP',
        enabled: true,
        taxonomyKey: 'eip',
        acceptParentName: true,
        specs: [{ name: '弹性公网IP-移动IP', match: ['移动IP'] }],
      },
      {
        key: '共享带宽',
        name: '共享带宽',
        enabled: true,
        taxonomyKey: '共享带宽',
        acceptParentName: true,
        specs: [],
      },
    ])
    expect(changed).toBe(true)
    expect(products.find((p) => p.key === '共享带宽')).toBeUndefined()
    const eip = products.find((p) => p.key === 'eip')
    expect(eip?.specs?.some((s) => s.name === '弹性公网IP-共享带宽')).toBe(true)
  })

  it('resolveProductFromSpec maps 共享带宽 to eip spec', async () => {
    await loadProductCatalogConfig()
    const resolved = resolveProductFromSpec('共享带宽')
    expect(resolved.inScope).toBe(true)
    expect(resolved.productKey).toBe('eip')
    expect(resolved.productName).toBe('弹性公网IP')
    expect(resolved.productSpec).toBe('弹性公网IP-共享带宽')
    expect(resolved.taxonomyKey).toBe('eip')
  })
})
