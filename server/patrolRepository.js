/**
 * API 巡检 meta 读取（注册表/根因规则/未登记告警）——patrolCompress 等服务端消费方共用。
 * storageRepository.getMeta 返回已解析对象（M2 坑教训）。
 */
import { storageRepository } from './storageRepository.js'

/** @typedef {import('./patrolSeeds.js').PatrolApiRegistryItem} PatrolApiRegistryItem */
/** @typedef {import('./patrolSeeds.js').PatrolRootCauseRule} PatrolRootCauseRule */

/** @returns {PatrolApiRegistryItem[]} */
export function readPatrolRegistryItems() {
  const parsed = storageRepository.getMeta('api_patrol_api_registry_v1')
  return parsed && Array.isArray(parsed.items) ? parsed.items : []
}

/** @returns {PatrolRootCauseRule[]} */
export function readPatrolRootCauseRules() {
  const parsed = storageRepository.getMeta('api_patrol_root_cause_rules_v1')
  return parsed && Array.isArray(parsed.items) ? parsed.items : []
}

/** @returns {string[]} */
export function readPatrolUnregisteredApis() {
  const parsed = storageRepository.getMeta('api_patrol_unregistered_apis_v1')
  return parsed && Array.isArray(parsed.items) ? parsed.items : []
}
