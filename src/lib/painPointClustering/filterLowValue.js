import { LOW_VALUE_PROBLEM_TYPES } from './constants.js'

/**
 * @typedef {import('./primaryCluster.js').PrimaryPainCluster} PrimaryPainCluster
 */

/**
 * @param {PrimaryPainCluster} cluster
 */
export function isLowValuePrimaryCluster(cluster, profile = null) {
  const lowValueTypes = profile?.lowValueProblemTypes || LOW_VALUE_PROBLEM_TYPES
  return lowValueTypes.has(cluster.problemType?.trim() || '')
}

/**
 * @param {PrimaryPainCluster[]} primaryClusters
 */
export function filterLowValuePrimaryClusters(primaryClusters, profile = null) {
  /** @type {PrimaryPainCluster[]} */
  const retained = []
  /** @type {PrimaryPainCluster[]} */
  const excluded = []

  for (const c of primaryClusters) {
    if (isLowValuePrimaryCluster(c, profile)) excluded.push(c)
    else retained.push(c)
  }

  const excludedTicketCount = excluded.reduce((sum, c) => sum + c.ticketCount, 0)

  return {
    retained,
    excluded,
    excludedClusterCount: excluded.length,
    excludedTicketCount,
  }
}
