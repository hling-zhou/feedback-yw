import { describe, it, expect } from 'vitest'
import {
  migrateSharedBandwidthTaxonomyProduct,
  migrateSharedBandwidthRecordToEip,
} from './migrateSharedBandwidthToEip.js'

describe('migrateSharedBandwidthToEip', () => {
  it('removes standalone taxonomy product', () => {
    const snapshot = {
      products: {
        eip: { key: 'eip', name: '弹性公网IP', match: [], journeys: [] },
        共享带宽: { key: '共享带宽', name: '共享带宽', match: [], journeys: [] },
      },
      sharedProblemTypes: [],
    }
    expect(migrateSharedBandwidthTaxonomyProduct(snapshot)).toBe(true)
    expect(snapshot.products['共享带宽']).toBeUndefined()
    expect(snapshot.products.eip).toBeDefined()
  })

  it('rewrites record product fields to eip spec', () => {
    const record = {
      productKey: '共享带宽',
      taxonomyKey: '共享带宽',
      product: '共享带宽',
      productSpec: '共享带宽',
    }
    expect(migrateSharedBandwidthRecordToEip(record)).toBe(true)
    expect(record.productKey).toBe('eip')
    expect(record.taxonomyKey).toBe('eip')
    expect(record.product).toBe('弹性公网IP')
    expect(record.productSpec).toBe('弹性公网IP-共享带宽')
  })
})
