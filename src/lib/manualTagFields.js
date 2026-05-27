import { themesFromJourney } from './applyThemes.js'
import { normalizeSentiment } from './sentiment.js'

/** @typedef {'requestScene' | 'problemType' | 'journey' | 'sentiment'} ManualTagDimension */

/** @type {ManualTagDimension[]} */
export const MANUAL_TAG_DIMENSIONS = ['requestScene', 'problemType', 'journey', 'sentiment']

/** @type {Record<ManualTagDimension, string>} */
export const MANUAL_TAG_DIMENSION_LABELS = {
  requestScene: '请求场景',
  problemType: '问题类型',
  journey: '用户旅程',
  sentiment: '用户情绪',
}

/**
 * @param {import('./types.js').FeedbackRecord} record
 * @returns {ManualTagDimension[]}
 */
export function getManualTagFields(record) {
  const raw = record?.manualTagFields
  if (!Array.isArray(raw)) return []
  return raw.filter((k) => MANUAL_TAG_DIMENSIONS.includes(/** @type {ManualTagDimension} */ (k)))
}

/**
 * 用户在工单详情中保存四维标签时，记录对应维度为人工维护。
 *
 * @param {import('./types.js').FeedbackRecord | undefined} existing
 * @param {Partial<import('./types.js').FeedbackRecord>} patch
 * @returns {ManualTagDimension[]}
 */
export function mergeManualTagFieldsOnUserEdit(existing, patch) {
  const set = new Set(getManualTagFields(existing))
  if ('requestScene' in patch) set.add('requestScene')
  if ('problemType' in patch) set.add('problemType')
  if ('journeyL1' in patch || 'journeyL2' in patch || 'themes' in patch) set.add('journey')
  if ('sentiment' in patch) set.add('sentiment')
  return [...set]
}

/**
 * 重新打标后还原人工维护的四维标签（及同步的 themes）。
 *
 * @param {import('./types.js').FeedbackRecord} original
 * @param {import('./types.js').FeedbackRecord} processed
 */
export function preserveManualTags(original, processed) {
  const manual = getManualTagFields(original)
  if (!manual.length) return processed

  const set = new Set(manual)
  const out = {
    ...processed,
    manualTagFields: manual,
  }

  if (set.has('requestScene')) {
    out.requestScene = original.requestScene
  }
  if (set.has('problemType')) {
    out.problemType = original.problemType
  }
  if (set.has('journey')) {
    out.journeyL1 = original.journeyL1
    out.journeyL2 = original.journeyL2
    out.themes =
      original.themes?.length ? original.themes : themesFromJourney(original)
  }
  if (set.has('sentiment')) {
    out.sentiment = normalizeSentiment(original.sentiment)
  }

  return out
}

/**
 * @param {import('./types.js').FeedbackRecord} record
 */
export function formatManualTagFieldsHint(record) {
  const fields = getManualTagFields(record)
  if (!fields.length) return ''
  return fields.map((k) => MANUAL_TAG_DIMENSION_LABELS[k]).join('、')
}
