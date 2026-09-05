import { describe, expect, it } from 'vitest'
import { migrateSlbJourneysInSnapshot } from './migrateSlbJourneys.js'
import { SLB_USER_JOURNEY } from '../journeys/slbJourney.js'

describe('migrateSlbJourneysInSnapshot', () => {
  it('renames SLB to slb and injects builtin journeys', () => {
    const snapshot = {
      products: {
        SLB: {
          key: 'SLB',
          name: '弹性负载均衡',
          match: ['弹性负载均衡'],
          journeys: [],
          journeyConfigured: false,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateSlbJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.SLB).toBeUndefined()
    expect(snapshot.products.slb.key).toBe('slb')
    expect(snapshot.products.slb.journeyConfigured).toBe(true)
    expect(snapshot.products.slb.journeys).toHaveLength(SLB_USER_JOURNEY.length)
    expect(snapshot.products.slb.journeys.some((j) => j.id === 'configure')).toBe(true)
  })

  it('injects builtin journeys when slb template is empty', () => {
    const snapshot = {
      products: {
        slb: {
          key: 'slb',
          name: '弹性负载均衡',
          match: ['弹性负载均衡'],
          journeys: [],
          journeyConfigured: false,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateSlbJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.slb.journeyConfigured).toBe(true)
    expect(snapshot.products.slb.journeys).toHaveLength(SLB_USER_JOURNEY.length)
  })

  it('upgrades slb when calibration version is stale', () => {
    const snapshot = {
      products: {
        slb: {
          key: 'slb',
          name: '弹性负载均衡',
          match: ['弹性负载均衡'],
          journeys: [{ id: 'old', label: '旧', children: [] }],
          journeyConfigured: true,
          journeyCalibrationVersion: 1,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateSlbJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.slb.journeys).toHaveLength(SLB_USER_JOURNEY.length)
    expect(snapshot.products.slb.journeyCalibrationVersion).toBe(2)
  })
})
