import { describe, it, expect } from 'vitest'
import {
  migrateDcProductKeyInSnapshot,
  migrateDcProductKeyOnRecord,
} from './migrateDcProductKey.js'
import { DC_USER_JOURNEY } from '../journeys/dcJourney.js'

describe('migrateDcProductKey', () => {
  it('renames ecc to dc and injects builtin journeys', () => {
    const snapshot = {
      products: {
        ecc: {
          key: 'ecc',
          name: '云专线',
          match: ['云专线'],
          journeys: [],
          journeyConfigured: false,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateDcProductKeyInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.ecc).toBeUndefined()
    expect(snapshot.products.dc.key).toBe('dc')
    expect(snapshot.products.dc.journeyConfigured).toBe(true)
    expect(snapshot.products.dc.journeys).toHaveLength(DC_USER_JOURNEY.length)
  })

  it('replaces stale dc journeys that still have 故障与应急', () => {
    const snapshot = {
      products: {
        dc: {
          key: 'dc',
          name: '云专线',
          match: ['云专线'],
          journeys: [{ id: 'incident', label: '故障与应急', children: [] }],
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateDcProductKeyInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.dc.journeys).toHaveLength(DC_USER_JOURNEY.length)
    expect(snapshot.products.dc.journeys.some((j) => j.id === 'incident')).toBe(false)
  })

  it('migrates record productKey and taxonomyKey', () => {
    const record = { productKey: 'ecc', taxonomyKey: 'yunzx' }
    expect(migrateDcProductKeyOnRecord(record)).toBe(true)
    expect(record.productKey).toBe('dc')
    expect(record.taxonomyKey).toBe('dc')
  })
})
