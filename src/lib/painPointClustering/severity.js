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
