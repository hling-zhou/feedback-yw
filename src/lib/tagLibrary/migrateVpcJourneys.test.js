import { describe, it, expect } from 'vitest'
import { migrateVpcJourneysInSnapshot } from './migrateVpcJourneys.js'
import { VPC_PRODUCT_MATCH, VPC_USER_JOURNEY } from '../journeys/vpcJourney.js'

describe('migrateVpcJourneysInSnapshot', () => {
  it('creates vpc product with builtin journeys when missing', () => {
    const snapshot = { products: {}, sharedProblemTypes: [] }
    expect(migrateVpcJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.vpc.journeys).toHaveLength(VPC_USER_JOURNEY.length)
    expect(snapshot.products.vpc.journeyConfigured).toBe(true)
  })

  it('fills journeys when vpc exists but unconfigured', () => {
    const snapshot = {
      products: {
        vpc: {
          key: 'vpc',
          name: '虚拟私有云',
          match: [],
          journeys: [],
          journeyConfigured: false,
          catalogProvisioned: true,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateVpcJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.vpc.journeys).toHaveLength(VPC_USER_JOURNEY.length)
    expect(snapshot.products.vpc.journeyConfigured).toBe(true)
  })

  it('is no-op when vpc already on latest calibration version', () => {
    const snapshot = {
      products: {
        vpc: {
          key: 'vpc',
          name: '虚拟私有云',
          match: VPC_PRODUCT_MATCH,
          journeys: structuredClone(VPC_USER_JOURNEY),
          journeyConfigured: true,
          journeyCalibrationVersion: 4,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateVpcJourneysInSnapshot(snapshot)).toBe(false)
  })

  it('upgrades vpc when calibration version is stale', () => {
    const snapshot = {
      products: {
        vpc: {
          key: 'vpc',
          name: '虚拟私有云',
          match: [],
          journeys: [{ id: 'old', label: '旧', children: [] }],
          journeyConfigured: true,
          journeyCalibrationVersion: 1,
        },
      },
      sharedProblemTypes: [],
    }
    expect(migrateVpcJourneysInSnapshot(snapshot)).toBe(true)
    expect(snapshot.products.vpc.journeys).toHaveLength(7)
  })
})
