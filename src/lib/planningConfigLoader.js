/** @typedef {Record<string, number>} SignalWeightsMap */

/**
 * @typedef {Object} PlanningPlaybookConfig
 * @property {number} version
 * @property {Record<string, string[]>} [journeys]
 * @property {Record<string, string[]>} [problemTypes]
 * @property {Record<string, { journeys?: Record<string, string[]>; problemTypes?: Record<string, string[]> }>} [products]
 */

/**
 * @typedef {Object} PlanningSignalWeightsConfig
 * @property {number} version
 * @property {SignalWeightsMap} weights
 */

const DEFAULT_SIGNAL_WEIGHTS = {
  journey_hotspot: 1,
  problem_type: 0.9,
  wan_tou: 1.2,
  root_cause: 1,
  risk_negative: 1.1,
  risk_trend: 1,
}

/** @type {PlanningPlaybookConfig | null} */
let playbookCache = null
/** @type {PlanningSignalWeightsConfig | null} */
let weightsCache = null

/**
 * @param {string} path
 */
async function fetchJsonConfig(path) {
  const res = await fetch(path, { cache: 'no-cache' })
  if (!res.ok) return null
  return res.json()
}

export async function loadPlanningConfig() {
  const [playbook, weights] = await Promise.all([
    fetchJsonConfig('/config/planning/playbook.json'),
    fetchJsonConfig('/config/planning/signal-weights.json'),
  ])
  playbookCache = playbook && typeof playbook === 'object' ? playbook : { version: 0, journeys: {}, problemTypes: {} }
  weightsCache =
    weights && typeof weights === 'object'
      ? weights
      : { version: 0, weights: DEFAULT_SIGNAL_WEIGHTS }
  return { playbook: playbookCache, weights: weightsCache }
}

export function getPlanningConfigVersions() {
  return {
    playbookVersion: String(playbookCache?.version ?? 0),
    signalWeightsVersion: String(weightsCache?.version ?? 0),
  }
}

/**
 * @param {string} [signalType]
 */
export function getSignalWeight(signalType) {
  const weights = weightsCache?.weights || DEFAULT_SIGNAL_WEIGHTS
  if (!signalType) return 1
  return weights[signalType] ?? 1
}

/**
 * @param {string} l2
 * @param {string} [product]
 */
export function getConfiguredJourneyTips(l2, product) {
  const pb = playbookCache
  if (!pb || !l2) return []
  const productTips = product && pb.products?.[product]?.journeys?.[l2]
  if (productTips?.length) return [...productTips]
  return pb.journeys?.[l2] ? [...pb.journeys[l2]] : []
}

/**
 * @param {string} problemType
 * @param {string} [product]
 */
export function getConfiguredProblemTypeTips(problemType, product) {
  const pb = playbookCache
  if (!pb || !problemType) return []
  const productTips = product && pb.products?.[product]?.problemTypes?.[problemType]
  if (productTips?.length) return [...productTips]
  return pb.problemTypes?.[problemType] ? [...pb.problemTypes[problemType]] : []
}
