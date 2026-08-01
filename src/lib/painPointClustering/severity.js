import { PROBLEM_TYPE_SEVERITY } from './constants.js'

/**
 * @param {string} [problemType]
 */
export function getSeverityFromProblemType(problemType) {
  const key = (problemType || '').trim()
  if (key in PROBLEM_TYPE_SEVERITY) return PROBLEM_TYPE_SEVERITY[key]
  return PROBLEM_TYPE_SEVERITY['其他']
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function getMaxSeverity(records) {
  let max = 0
  for (const r of records) {
    max = Math.max(max, getSeverityFromProblemType(r.problemType))
  }
  return max
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function getSeverityValues(records) {
  return (records || []).map((record) => getSeverityFromProblemType(record?.problemType))
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function getP90Severity(records) {
  const values = getSeverityValues(records).sort((a, b) => a - b)
  if (!values.length) return 0
  const idx = Math.ceil(values.length * 0.9) - 1
  return values[Math.max(0, Math.min(values.length - 1, idx))]
}
