import { migrateDcProductKeyInSnapshot } from './migrateDcProductKey.js'
import { migrateEipJourneysInSnapshot } from './migrateEipJourneys.js'
import { migrateSlbJourneysInSnapshot } from './migrateSlbJourneys.js'
import { migrateVpcJourneysInSnapshot } from './migrateVpcJourneys.js'
import { migrateVpcEndpointJourneysInSnapshot } from './migrateVpcEndpointJourneys.js'
import { migrateMonitorJourneysInSnapshot } from './migrateMonitorJourneys.js'
import { migrateCcJourneysInSnapshot } from './migrateCcJourneys.js'
import { migrateNatJourneysInSnapshot } from './migrateNatJourneys.js'
import { migrateVpnJourneysInSnapshot } from './migrateVpnJourneys.js'
import { migrateDomainRegJourneysInSnapshot } from './migrateDomainRegJourneys.js'
import { migrateClouddnsJourneysInSnapshot } from './migrateClouddnsJourneys.js'
import { migratePrivateDnsJourneysInSnapshot } from './migratePrivateDnsJourneys.js'
import { migrateCloudPortJourneysInSnapshot } from './migrateCloudPortJourneys.js'
import { migrateGtmJourneysInSnapshot } from './migrateGtmJourneys.js'
import { migrateSbaJourneysInSnapshot } from './migrateSbaJourneys.js'
import { migrateCmcJourneysInSnapshot } from './migrateCmcJourneys.js'
import { migrateAipatrolJourneysInSnapshot } from './migrateAipatrolJourneys.js'

/**
 * 将内置用户旅程注入托管标签库
 * （eip / dc / slb / vpc / vpc_endpoint / monitor / cc / nat / vpn
 *   / domain_reg / CloudDNS / privateDNS / cloud_port / gtm / sba / cmc / aipatrol）。
 * @param {import('./taxonomyManageModel.js').TaxonomyManagedSnapshot} snapshot
 * @returns {boolean}
 */
export function migrateBuiltinJourneysInSnapshot(snapshot) {
  let changed = false
  changed = migrateEipJourneysInSnapshot(snapshot) || changed
  changed = migrateDcProductKeyInSnapshot(snapshot) || changed
  changed = migrateSlbJourneysInSnapshot(snapshot) || changed
  changed = migrateVpcJourneysInSnapshot(snapshot) || changed
  changed = migrateVpcEndpointJourneysInSnapshot(snapshot) || changed
  changed = migrateMonitorJourneysInSnapshot(snapshot) || changed
  changed = migrateCcJourneysInSnapshot(snapshot) || changed
  changed = migrateNatJourneysInSnapshot(snapshot) || changed
  changed = migrateVpnJourneysInSnapshot(snapshot) || changed
  changed = migrateDomainRegJourneysInSnapshot(snapshot) || changed
  changed = migrateClouddnsJourneysInSnapshot(snapshot) || changed
  changed = migratePrivateDnsJourneysInSnapshot(snapshot) || changed
  changed = migrateCloudPortJourneysInSnapshot(snapshot) || changed
  changed = migrateGtmJourneysInSnapshot(snapshot) || changed
  changed = migrateSbaJourneysInSnapshot(snapshot) || changed
  changed = migrateCmcJourneysInSnapshot(snapshot) || changed
  changed = migrateAipatrolJourneysInSnapshot(snapshot) || changed
  return changed
}
