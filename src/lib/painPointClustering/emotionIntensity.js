import { EMOTION_BASE_SCORE, EMOTION_SCORE_MAX, URGENCY_BONUS } from './constants.js'
import { getUrgencyLevel, normalizeSentiment } from '../sentiment.js'

/**
 * @param {import('../types.js').FeedbackRecord} record
 */
export function getEmotionIntensity(record) {
  const sentiment = normalizeSentiment(record.sentiment)
  const base = EMOTION_BASE_SCORE[sentiment] ?? EMOTION_BASE_SCORE.neutral_inquiry
  const bonus = getUrgencyLevel(record) === 'high' ? URGENCY_BONUS : 0
  return Math.min(EMOTION_SCORE_MAX, base + bonus)
}

/**
 * @param {number[]} values
 */
export function percentile90(values) {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const idx = Math.ceil(0.9 * sorted.length) - 1
  return sorted[Math.max(0, Math.min(sorted.length - 1, idx))]
}

/**
 * @param {import('../types.js').FeedbackRecord[]} records
 */
export function getP90EmotionIntensity(records) {
  if (!records.length) return 0
  return percentile90(records.map(getEmotionIntensity))
}
