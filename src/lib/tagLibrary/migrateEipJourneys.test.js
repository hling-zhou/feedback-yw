import { describe, expect, it } from 'vitest'
import { migrateEipJourneysInSnapshot } from './migrateEipJourneys.js'
import { EIP_PRODUCT_MATCH, EIP_USER_JOURNEY } from '../journeys/eipJourney.js'

describe('migrateEipJourneysInSnapshot', () => {
  it('creates eip product with builtin journeys when missing', () => {
    const snapshot = { products: {}, sharedProblemTypes: [] }
    expect(migrateEipJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.eip.journeys).toHaveLength(EIP_USER_JOURNEY.length)
    expect(snapshot.products.eip.journeyConfigured).toBe(true)
    expect(snapshot.products.eip.journeys.some((j) => j.id === 'incident')).toBe(false)
  })

  it('replaces stale EIP journeys that still have 故障与应急', () => {
    const snapshot = {
      products: {
        eip: {
          key: 'eip',
          name: '弹性公网IP',
          match: [],
          journeys: [{ id: 'incident', label: '故障与应急', children: [] }],
          journeyConfigured: true,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateEipJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.eip.journeys).toHaveLength(EIP_USER_JOURNEY.length)
    expect(snapshot.products.eip.journeys.some((j) => j.id === 'incident')).toBe(false)
    expect(snapshot.products.eip.journeys.some((j) => j.id === 'provision')).toBe(true)
  })

  it('is no-op when eip already on latest calibration version', () => {
    const snapshot = {
      products: {
        eip: {
          key: 'eip',
          name: '弹性公网IP',
          match: EIP_PRODUCT_MATCH,
          journeys: structuredClone(EIP_USER_JOURNEY),
          journeyConfigured: true,
          journeyCalibrationVersion: 1,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateEipJourneysInSnapshot(snapshot)).toBe(false)
  })
})
