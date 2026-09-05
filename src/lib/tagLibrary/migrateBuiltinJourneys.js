import { migrateDcProductKeyInSnapshot } from './migrateDcProductKey.js'
import { migrateEipJourneysInSnapshot } from './migrateEipJourneys.js'
import { migrateSlbJourneysInSnapshot } from './migrateSlbJourneys.js'
import { migrateVpcJourneysInSnapshot } from './migrateVpcJourneys.js'
import { migrateMonitorJourneysInSnapshot } from './migrateMonitorJourneys.js'
import { migrateCcJourneysInSnapshot } from './migrateCcJourneys.js'
import { migrateNatJourneysInSnapshot } from './migrateNatJourneys.js'
import { migrateVpnJourneysInSnapshot } from './migrateVpnJourneys.js'

/**
 * 将内置用户旅程注入托管标签库（eip / dc / slb / vpc / monitor / cc / nat / vpn 等）。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateBuiltinJourneysInSnapshot(snapshot) {
  let changed = false
  changed = migrateEipJourneysInSnapshot(snapshot) || changed
  changed = migrateDcProductKeyInSnapshot(snapshot) || changed
  changed = migrateSlbJourneysInSnapshot(snapshot) || changed
  changed = migrateVpcJourneysInSnapshot(snapshot) || changed
  changed = migrateMonitorJourneysInSnapshot(snapshot) || changed
  changed = migrateCcJourneysInSnapshot(snapshot) || changed
  changed = migrateNatJourneysInSnapshot(snapshot) || changed
  changed = migrateVpnJourneysInSnapshot(snapshot) || changed
  return changed
}
