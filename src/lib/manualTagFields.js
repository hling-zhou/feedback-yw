import { themesFromJourney } from './applyThemes.js'
import { normalizeSentiment, normalizeUrgencyLevel } from './sentiment.js'
import { applyForceAllHumanOverrides } from '../domain/overridePolicy.js'

/** @typedef {'requestScene' | 'problemType' | 'journey' | 'sentiment' | 'urgency' | 'optimization' | 'customerRequest' | 'painPoint' | 'rootCauseReview' | 'complaintCauseReview'} ManualTagDimension */

/** @type {ManualTagDimension[]} */
export const MANUAL_TAG_DIMENSIONS = [
  'requestScene',
  'problemType',
  'journey',
  'sentiment',
  'urgency',
  'optimization',
  'customerRequest',
  'painPoint',
  'rootCauseReview',
  'complaintCauseReview',
]

/** @type {Record<ManualTagDimension, string>} */
export const MANUAL_TAG_DIMENSION_LABELS = {
  requestScene: '请求场景',
  problemType: '问题类型',
  journey: '用户旅程',
  sentiment: '用户情绪',
  urgency: '加急',
  optimization: '优化建议',
  customerRequest: '客户请求',
  painPoint: '需求痛点',
  rootCauseReview: '根因排查',
  complaintCauseReview: '投诉原因（终判）复核',
}

const OPTIMIZATION_HUMAN_PATCH_KEYS = /** @type {const} */ ([
  'manualReviewOptimization',
  'establishedAction',
  'actionSchedule',
  'actionId',
  'productGroupOptimization',
  'designerOptimization',
])

/**
 * @param {unknown} a
 * @param {unknown} b
 */
function fieldValueEqual(a, b) {
  return String(a ?? '').trim() === String(b ?? '').trim()
}

/**
 * @param {string | undefined | null} source
 */
function storedSourceIsManualOrImport(source) {
  return source === 'manual' || source === 'import'
}

/**
 * ticket LLM 成功写入后，若库内来源本非人工/导入，则不应再因陈旧 manualTagFields 拉回旧内容。
 *
 * @param {import('./types.js').FeedbackRecord} original
 * @param {'customerRequest' | 'painPoint'} dimension
 * @param {import('./types.js').FeedbackRecord} processed
 */
function shouldPreserveManualAnalysisField(original, dimension, processed) {
  const origSource =
    dimension === 'customerRequest'
      ? original.customerRequestSource
      : original.painPointSource
  const nextSource =
    dimension === 'customerRequest'
      ? processed.customerRequestSource
      : processed.painPointSource
  if (storedSourceIsManualOrImport(origSource)) return true
  if (nextSource === 'llm') return false
  return true
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
 * 用户在工单详情中保存时，仅当 patch 相对现有记录**实际变更**才累积人工维护维度。
 *
 * @param {import('./types.js').FeedbackRecord | undefined} existing
 * @param {Partial<import('./types.js').FeedbackRecord>} patch
 * @returns {ManualTagDimension[]}
 */
export function mergeManualTagFieldsOnUserEdit(existing, patch) {
  const set = new Set(getManualTagFields(existing))

  if ('requestScene' in patch && !fieldValueEqual(existing?.requestScene, patch.requestScene)) {
    set.add('requestScene')
  }
  if ('problemType' in patch && !fieldValueEqual(existing?.problemType, patch.problemType)) {
    set.add('problemType')
  }
  if (
    ('journeyL1' in patch && !fieldValueEqual(existing?.journeyL1, patch.journeyL1)) ||
    ('journeyL2' in patch && !fieldValueEqual(existing?.journeyL2, patch.journeyL2))
  ) {
    set.add('journey')
  }
  if ('sentiment' in patch && !fieldValueEqual(existing?.sentiment, patch.sentiment)) {
    set.add('sentiment')
  }
  if ('urgencyLevel' in patch && !fieldValueEqual(existing?.urgencyLevel, patch.urgencyLevel)) {
    set.add('urgency')
  }

  for (const key of OPTIMIZATION_HUMAN_PATCH_KEYS) {
    if (key in patch && !fieldValueEqual(existing?.[key], patch[key])) {
      set.add('optimization')
      break
    }
  }

  if ('customerRequest' in patch) {
    const next = String(patch.customerRequest ?? '').trim()
    const prev = String(existing?.customerRequest ?? '').trim()
    if (next !== prev) set.add('customerRequest')
  }
  if ('painPoint' in patch || 'problemSummary' in patch) {
    const next = String(patch.painPoint ?? patch.problemSummary ?? '').trim()
    const prev = String(existing?.painPoint ?? existing?.problemSummary ?? '').trim()
    if (next !== prev) set.add('painPoint')
  }
  if ('rootCauseReview' in patch && !fieldValueEqual(existing?.rootCauseReview, patch.rootCauseReview)) {
    set.add('rootCauseReview')
  }
  if (
    ('complaintCauseL1Review' in patch
      && !fieldValueEqual(existing?.complaintCauseL1Review, patch.complaintCauseL1Review))
    || ('complaintCauseL2Review' in patch
      && !fieldValueEqual(existing?.complaintCauseL2Review, patch.complaintCauseL2Review))
    || ('complaintCauseL3Review' in patch
      && !fieldValueEqual(existing?.complaintCauseL3Review, patch.complaintCauseL3Review))
    || ('complaintCauseReviewReason' in patch
      && !fieldValueEqual(existing?.complaintCauseReviewReason, patch.complaintCauseReviewReason))
  ) {
    set.add('complaintCauseReview')
  }

  return [...set]
}

/**
 * 批量强制重打标：清空人工标记与人工复核文本，便于全量重算。
 *
 * @param {import('./types.js').FeedbackRecord} record
 */
export function applyForceRetagOverrides(record) {
  return applyForceAllHumanOverrides(record)
}

/**
 *
 * @param {import('./types.js').FeedbackRecord} original
 * @param {import('./types.js').FeedbackRecord} processed
 * @param {{ forceOverride?: boolean }} [options]
 */
export function preserveManualTags(original, processed, options = {}) {
  if (options.forceOverride) return processed

  const manual = getManualTagFields(original)
  if (!manual.length) return processed

  const set = new Set(manual)
  const out = {
    ...processed,
    manualTagFields: manual,
    lastAutoTags: processed.lastAutoTags || original.lastAutoTags,
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
    out.journeySource = original.journeySource
    out.journeyMatchScore = original.journeyMatchScore
  }
  if (set.has('sentiment')) {
    out.sentiment = normalizeSentiment(original.sentiment)
  }
  if (set.has('urgency')) {
    out.urgencyLevel = normalizeUrgencyLevel(original.urgencyLevel, original.sentiment)
  }
  if (set.has('optimization')) {
    out.manualReviewOptimization = original.manualReviewOptimization
    out.establishedAction = original.establishedAction
    out.actionSchedule = original.actionSchedule
    out.actionId = original.actionId
    out.productGroupOptimization = original.productGroupOptimization
    out.designerOptimization = original.designerOptimization
  }
  if (set.has('customerRequest') && shouldPreserveManualAnalysisField(original, 'customerRequest', processed)) {
    out.customerRequest = original.customerRequest
    out.customerRequestSource = original.customerRequestSource
  }
  if (set.has('painPoint') && shouldPreserveManualAnalysisField(original, 'painPoint', processed)) {
    out.painPoint = original.painPoint
    out.problemSummary = original.problemSummary
    out.painPointSource = original.painPointSource
  }
  if (set.has('rootCauseReview')) {
    out.rootCauseReview = original.rootCauseReview
  }
  if (set.has('complaintCauseReview')) {
    out.complaintCauseL1Review = original.complaintCauseL1Review
    out.complaintCauseL2Review = original.complaintCauseL2Review
    out.complaintCauseL3Review = original.complaintCauseL3Review
    out.complaintCauseReviewReason = original.complaintCauseReviewReason
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
