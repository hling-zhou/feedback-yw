import { migrateDcProductKeyInSnapshot } from './migrateDcProductKey.js'
import { migrateSlbJourneysInSnapshot } from './migrateSlbJourneys.js'
import { migrateVpcJourneysInSnapshot } from './migrateVpcJourneys.js'

/**
 * 将内置用户旅程注入托管标签库（dc / slb / vpc 等）。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateBuiltinJourneysInSnapshot(snapshot) {
  let changed = false
  changed = migrateDcProductKeyInSnapshot(snapshot) || changed
  changed = migrateSlbJourneysInSnapshot(snapshot) || changed
  changed = migrateVpcJourneysInSnapshot(snapshot) || changed
  return changed
}
