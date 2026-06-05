/**
 * 反馈库筛选：回访满意度相关条件与 URL 参数。
 * @see docs/DESIGN-用后即评-满意度回访.md §5.1
 */

import {
  DISSATISFIED_REASON_PART_KEYS,
  getFollowUpScore,
  hasFollowUpSatisfaction,
} from '../domain/followUpSatisfaction.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/** @typedef {'has' | 'none' | '10' | 'non10'} FollowUpFilterValue */
/** @typedef {'resolved' | 'unresolved'} FollowUpResolvedFilterValue */

/** URL 参数：匹配字段为空（图表「未分类」下钻） */
export const EMPTY_FILTER_TOKEN = '__empty__'

export const UNCLASSIFIED_CHART_LABEL = '未分类'

export const FOLLOW_UP_FILTER_OPTIONS = [
  { label: '全部回访', value: '' },
  { label: '有回访', value: 'has' },
  { label: '无回访', value: 'none' },
  { label: '10 分', value: '10' },
  { label: '非 10 分', value: 'non10' },
]

export const FOLLOW_UP_RESOLVED_FILTER_OPTIONS = [
  { label: '全部解决状态', value: '' },
  { label: '已解决', value: 'resolved' },
  { label: '未解决', value: 'unresolved' },
]

const FOLLOW_UP_FILTER_VALUES = new Set(['has', 'none', '10', 'non10'])
const FOLLOW_UP_RESOLVED_VALUES = new Set(['resolved', 'unresolved'])
const REASON_DIM_VALUES = new Set(DISSATISFIED_REASON_PART_KEYS)

/**
 * @param {FeedbackRecord | null | undefined} record
 */
export function isFollowUpEnrichableRecord(record) {
  const type = record?.dataSourceType
  return type === 'complaint_ticket' || type === 'consultation_ticket'
}

/**
 * @param {string | null | undefined} raw
 * @returns {FollowUpFilterValue | ''}
 */
export function parseFollowUpFilterParam(raw) {
  const value = raw?.trim()
  if (!value) return ''
  return FOLLOW_UP_FILTER_VALUES.has(value) ? /** @type {FollowUpFilterValue} */ (value) : ''
}

/**
 * @param {string | null | undefined} raw
 * @returns {FollowUpResolvedFilterValue | ''}
 */
export function parseFollowUpResolvedFilterParam(raw) {
  const value = raw?.trim()
  if (!value) return ''
  return FOLLOW_UP_RESOLVED_VALUES.has(value)
    ? /** @type {FollowUpResolvedFilterValue} */ (value)
    : ''
}

/**
 * @param {string | null | undefined} raw
 */
export function parseReasonDimParam(raw) {
  const value = raw?.trim()
  if (!value || !REASON_DIM_VALUES.has(value)) return ''
  return value
}

/**
 * @param {URLSearchParams | { get: (key: string) => string | null }} searchParams
 */
export function parseFeedbackFollowUpSearchParams(searchParams) {
  return {
    followUp: parseFollowUpFilterParam(searchParams.get('followUp')),
    followUpResolved: parseFollowUpResolvedFilterParam(searchParams.get('followUpResolved')),
    reasonDim: parseReasonDimParam(searchParams.get('reasonDim')),
    requestScene: searchParams.get('requestScene')?.trim() || '',
  }
}

/**
 * @param {FeedbackRecord} record
 * @param {{
 *   followUp?: FollowUpFilterValue | ''
 *   followUpResolved?: FollowUpResolvedFilterValue | ''
 *   reasonDim?: string
 * }} filters
 */
export function matchesFollowUpFilters(record, filters = {}) {
  const { followUp = '', followUpResolved = '', reasonDim = '' } = filters

  if (followUp) {
    const has = hasFollowUpSatisfaction(record)
    if (followUp === 'has' && !has) return false
    if (followUp === 'none' && has) return false
    if (followUp === '10') {
      if (!has || getFollowUpScore(record) !== 10) return false
    }
    if (followUp === 'non10') {
      if (!has || getFollowUpScore(record) === 10) return false
    }
  }

  if (followUpResolved) {
    if (!hasFollowUpSatisfaction(record)) return false
    const resolved = record.followUpSatisfaction?.problemResolved
    if (followUpResolved === 'resolved' && resolved !== 'resolved') return false
    if (followUpResolved === 'unresolved' && resolved !== 'unresolved') return false
  }

  if (reasonDim) {
    const parts = record.followUpSatisfaction?.dissatisfiedReasonParts
    const text = parts?.[reasonDim]?.trim()
    if (!text) return false
  }

  return true
}

/**
 * 反馈库文本字段筛选；`__empty__` 表示匹配空值（与图表「未分类」对应）。
 *
 * @param {string | undefined | null} recordValue
 * @param {string} filterValue
 */
export function matchesOptionalTextFilter(recordValue, filterValue) {
  if (!filterValue) return true
  if (filterValue === EMPTY_FILTER_TOKEN) {
    return !String(recordValue ?? '').trim()
  }
  return String(recordValue ?? '') === filterValue
}

/**
 * 图表标签 → 反馈库 query 参数（「未分类」→ __empty__）。
 *
 * @param {string} label
 */
export function drillDownFieldParam(label) {
  const text = String(label ?? '').trim()
  if (!text || text === UNCLASSIFIED_CHART_LABEL) return EMPTY_FILTER_TOKEN
  return text
}

/**
 * @param {URLSearchParams} base
 * @param {{
 *   followUp?: string
 *   followUpResolved?: string
 *   reasonDim?: string
 *   requestScene?: string
 * }} patch
 */
export function patchFeedbackFollowUpSearchParams(base, patch) {
  const next = new URLSearchParams(base)
  const fields = ['followUp', 'followUpResolved', 'reasonDim', 'requestScene']
  for (const key of fields) {
    if (!(key in patch)) continue
    const value = patch[key]?.trim()
    if (value) next.set(key, value)
    else next.delete(key)
  }
  return next
}

/**
 * @param {{
 *   month?: string
 *   product?: string
 *   problemType?: string
 *   complaintCauseL1?: string
 *   journeyL1?: string
 *   requestScene?: string
 *   followUp?: string
 *   followUpResolved?: string
 *   reasonDim?: string
 *   ticketId?: string
 *   ticketIds?: string
 *   source?: string
 * }} [params]
 */
export function buildFeedbacksUrl(params = {}) {
  const sp = new URLSearchParams()
  const stringFields = [
    'month',
    'product',
    'problemType',
    'complaintCauseL1',
    'journeyL1',
    'requestScene',
    'followUp',
    'followUpResolved',
    'reasonDim',
    'ticketId',
    'ticketIds',
    'source',
  ]
  for (const key of stringFields) {
    const value = params[key]?.trim()
    if (value) sp.set(key, value)
  }
  const qs = sp.toString()
  return qs ? `/feedbacks?${qs}` : '/feedbacks'
}

/**
 * 回访满意度图表下钻至反馈库（预填 followUp=non10 等）。
 *
 * @param {{
 *   productName?: string
 *   product?: string
 *   requestScene?: string
 *   problemType?: string
 *   reasonDim?: string
 *   followUp?: string
 *   followUpResolved?: string
 *   source?: string
 * }} [params]
 */
export function buildFollowUpDrillDownUrl(params = {}) {
  const product = params.productName?.trim() || params.product?.trim()
  return buildFeedbacksUrl({
    followUp: params.followUp?.trim() || 'non10',
    followUpResolved: params.followUpResolved,
    reasonDim: params.reasonDim,
    requestScene: params.requestScene,
    problemType: params.problemType,
    product,
    source: params.source,
  })
}
