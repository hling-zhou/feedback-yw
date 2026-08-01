import { normalizeCustomerTier } from '../../domain/customerTier.js'
import { getUrgencyLevel, isNegativeSentiment } from '../sentiment.js'
import { getEmotionIntensity } from './emotionIntensity.js'
import { getSeverityFromProblemType } from './severity.js'

function highValueCustomer(record) {
  const tier = normalizeCustomerTier(record?.customerTier)
  return tier === '金牌' || tier === '银牌'
}

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function computeSingletonRiskScore(record) {
  const severity = getSeverityFromProblemType(record?.problemType)
  const emotion = getEmotionIntensity(record)
  const urgent = getUrgencyLevel(record) === 'high' ? 1 : 0
  const unresolved = record?.followUpSatisfaction?.problemResolved === 'unresolved' ? 1 : 0
  const highValue = highValueCustomer(record) ? 1 : 0
  const negative = isNegativeSentiment(record?.sentiment) ? 1 : 0
  return severity * 0.9 + emotion * 0.5 + urgent * 0.9 + unresolved * 1.1 + highValue * 0.6 + negative * 0.4
}

/**
 * @param {import('../types.js').FeedbackRecord[]} isolatedRecords
 * @param {{
 *   enableHighRiskSingletons?: boolean
 *   singletonMinRiskScore?: number
 * }} [profile]
 */
export function identifyHighRiskSingletons(isolatedRecords, profile = {}) {
  if (!profile.enableHighRiskSingletons) return []
  const threshold = profile.singletonMinRiskScore ?? 4.5
  return (isolatedRecords || [])
    .map((record) => ({
      record,
      riskScore: computeSingletonRiskScore(record),
    }))
    .filter((row) => row.riskScore >= threshold)
    .sort((a, b) => b.riskScore - a.riskScore)
}
