/**
 * 反馈库筛选：回访满意度相关条件与 URL 参数。
 * @see docs/DESIGN-用后即评-满意度回访.md §5.1
 */

import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import { parseMyReviewFilterParam } from '../domain/userTicketReview.js'
import {
  DISSATISFIED_REASON_PART_KEYS,
  getFollowUpScore,
  hasFollowUpSatisfaction,
  isMeaningfulDissatisfiedReasonValue,
} from '../domain/followUpSatisfaction.js'
import {
  matchesTicketActualDateRange,
  parseTicketDateFilterParam,
} from '../domain/ticketActualDate.js'
import { hasOpenTicketTodos, hasOpenTicketTodosAssignedTo } from '../domain/ticketTodo.js'

/** @typedef {import('../lib/types.js').FeedbackRecord} FeedbackRecord */

/** @typedef {'has' | 'none' | '10' | 'non10'} FollowUpFilterValue */
/** @typedef {'resolved' | 'unresolved'} FollowUpResolvedFilterValue */
/** @typedef {'has_open' | 'no_open' | 'my_open'} TodoStatusFilterValue */

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

export const TODO_STATUS_FILTER_OPTIONS = [
  { label: '全部待办状态', value: '' },
  { label: '有待办', value: 'has_open' },
  { label: '无待办', value: 'no_open' },
  { label: '我的待办（未完成）', value: 'my_open' },
]

/** @typedef {'' | 'yes' | 'no'} ListeningReviewedFilterValue */

export const LISTENING_REVIEWED_FILTER_OPTIONS = [
  { label: '全部听音状态', value: '' },
  { label: '是', value: 'yes' },
  { label: '否', value: 'no' },
]

const FOLLOW_UP_FILTER_VALUES = new Set(['has', 'none', '10', 'non10'])
const FOLLOW_UP_RESOLVED_VALUES = new Set(['resolved', 'unresolved'])
const TODO_STATUS_FILTER_VALUES = new Set(['has_open', 'no_open', 'my_open'])
const LISTENING_REVIEWED_FILTER_VALUES = new Set(['yes', 'no'])
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
 * @param {string | null | undefined} raw
 * @returns {TodoStatusFilterValue | ''}
 */
export function parseTodoStatusFilterParam(raw) {
  const value = raw?.trim()
  if (!value) return ''
  return TODO_STATUS_FILTER_VALUES.has(value) ? /** @type {TodoStatusFilterValue} */ (value) : ''
}

/**
 * @param {FeedbackRecord} record
 * @param {TodoStatusFilterValue | ''} todoStatus
 * @param {{ userId?: string }} [ctx]
 */
export function matchesTodoStatusFilter(record, todoStatus = '', ctx = {}) {
  if (!todoStatus) return true
  const hasOpen = hasOpenTicketTodos(record)
  if (todoStatus === 'has_open') return hasOpen
  if (todoStatus === 'no_open') return !hasOpen
  if (todoStatus === 'my_open') {
    return hasOpenTicketTodosAssignedTo(record, ctx.userId || '')
  }
  return true
}

/**
 * @param {string | null | undefined} raw
 * @returns {ListeningReviewedFilterValue}
 */
export function parseListeningReviewedFilterParam(raw) {
  const value = raw?.trim()
  if (!value) return ''
  return LISTENING_REVIEWED_FILTER_VALUES.has(value)
    ? /** @type {ListeningReviewedFilterValue} */ (value)
    : ''
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {ListeningReviewedFilterValue} listeningReviewed
 */
export function matchesListeningReviewedFilter(record, listeningReviewed = '') {
  if (!listeningReviewed) return true
  const listened = Boolean(record?.listeningReviewed)
  if (listeningReviewed === 'yes') return listened
  if (listeningReviewed === 'no') return !listened
  return true
}

/**
 * 按处理意见字段做关键字模糊匹配（大小写不敏感子串）。
 *
 * @param {FeedbackRecord | null | undefined} record
 * @param {string} [keyword]
 */
export function matchesHandlingKeywordFilter(record, keyword = '') {
  const needle = String(keyword ?? '').trim().toLowerCase()
  if (!needle) return true
  const haystack = String(record?.handlingText ?? '').toLowerCase()
  return haystack.includes(needle)
}

/**
 * @param {FeedbackRecord | null | undefined} record
 * @param {string[]} [customerNames]
 */
export function matchesCustomerNamesFilter(record, customerNames = []) {
  if (!Array.isArray(customerNames) || customerNames.length === 0) return true
  const name = String(record?.customerName ?? '').trim()
  return Boolean(name) && customerNames.includes(name)
}

/**
 * @param {string | null | undefined} raw
 */
export function parseCustomerNamesParam(raw) {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => decodeURIComponent(t.trim()))
    .filter(Boolean)
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
    ticketDateFrom: parseTicketDateFilterParam(searchParams.get('ticketDateFrom')),
    ticketDateTo: parseTicketDateFilterParam(searchParams.get('ticketDateTo')),
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
    if (!isMeaningfulDissatisfiedReasonValue(text)) return false
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
 * @param {string | null | undefined} raw
 */
export function parseTicketIdsParam(raw) {
  if (!raw) return []
  return raw
    .split(',')
    .map((t) => decodeURIComponent(t.trim()))
    .filter(Boolean)
}

/**
 * @param {URLSearchParams | { get: (key: string) => string | null }} searchParams
 */
export function parseFeedbackSearchParams(searchParams) {
  const followUpParams = parseFeedbackFollowUpSearchParams(searchParams)
  const source = searchParams.get('source')?.trim() || ''
  const lane = searchParams.get('lane')?.trim() || ''
  const ticketIds = parseTicketIdsParam(searchParams.get('ticketIds'))
  const ticketId = parseTicketIdsParam(searchParams.get('ticketId'))
  return {
    ...followUpParams,
    product: searchParams.get('product')?.trim() || '',
    problemType: searchParams.get('problemType')?.trim() || '',
    complaintCauseL1: searchParams.get('complaintCauseL1')?.trim() || '',
    journeyL1: searchParams.get('journeyL1')?.trim() || '',
    dataSource: DATA_SOURCE_TYPES.includes(source) ? source : '',
    lane: lane === 'post_use' || lane === 'tickets' ? lane : '',
    ticketIds: ticketIds.length ? ticketIds : ticketId,
    customerNames: parseCustomerNamesParam(searchParams.get('customerNames')),
    myReview: parseMyReviewFilterParam(searchParams.get('myReview')),
    todoStatus: parseTodoStatusFilterParam(searchParams.get('todoStatus')),
    listeningReviewed: parseListeningReviewedFilterParam(searchParams.get('listeningReviewed')),
    handlingKeyword: searchParams.get('handlingKeyword')?.trim() || '',
    ratingScore: searchParams.get('ratingScore')?.trim() || '',
    channel: searchParams.get('channel')?.trim() || '',
    commentKeyword: searchParams.get('commentKeyword')?.trim() || '',
  }
}

/**
 * @param {URLSearchParams} base
 * @param {Record<string, string | undefined | null>} patch
 */
export function patchFeedbackSearchParams(base, patch) {
  const next = new URLSearchParams(base)
  const fields = [
    'product',
    'problemType',
    'complaintCauseL1',
    'journeyL1',
    'requestScene',
    'source',
    'lane',
    'followUp',
    'followUpResolved',
    'reasonDim',
    'ticketDateFrom',
    'ticketDateTo',
    'myReview',
    'todoStatus',
    'listeningReviewed',
    'handlingKeyword',
    'ratingScore',
    'channel',
    'commentKeyword',
  ]
  for (const key of fields) {
    if (!(key in patch)) continue
    const value = patch[key]?.trim()
    if (value) next.set(key, value)
    else next.delete(key)
  }
  if ('ticketIds' in patch) {
    const value = patch.ticketIds?.trim()
    if (value) next.set('ticketIds', value)
    else next.delete('ticketIds')
  }
  if ('customerNames' in patch) {
    const value = patch.customerNames?.trim()
    if (value) next.set('customerNames', value)
    else next.delete('customerNames')
  }
  return next
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
  const fields = [
    'followUp',
    'followUpResolved',
    'reasonDim',
    'requestScene',
    'ticketDateFrom',
    'ticketDateTo',
  ]
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
 *   ticketDateFrom?: string
 *   ticketDateTo?: string
 *   source?: string
 *   todoStatus?: string
 *   listeningReviewed?: string
 *   handlingKeyword?: string
 *   ratingScore?: string
 *   channel?: string
 *   commentKeyword?: string
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
    'customerNames',
    'ticketDateFrom',
    'ticketDateTo',
    'source',
    'lane',
    'todoStatus',
    'listeningReviewed',
    'handlingKeyword',
    'ratingScore',
    'channel',
    'commentKeyword',
  ]
  for (const key of stringFields) {
    const value = params[key]?.trim()
    if (value) sp.set(key, value)
  }
  const qs = sp.toString()
  return qs ? `/feedbacks?${qs}` : '/feedbacks'
}

/**
 * 按工单号跳转反馈库列表筛选（不打开抽屉）。
 * 兼容旧链接 `ticketId=`：解析时也会并入 ticketIds。
 *
 * @param {string | null | undefined} ticketId
 */
export function buildFeedbacksTicketFilterHref(ticketId) {
  const id = String(ticketId || '').trim()
  return id ? buildFeedbacksUrl({ ticketIds: id }) : '/feedbacks'
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

/**
 * 洞察工作台 · 投诉/咨询工单 Tab 图表下钻至反馈库。
 *
 * @param {{
 *   source?: string
 *   month?: string
 *   product?: string
 *   requestScene?: string
 *   problemType?: string
 *   complaintCauseL1?: string
 * }} [params]
 */
export function buildTicketWorkbenchDrillDownUrl(params = {}) {
  return buildFeedbacksUrl({
    source: params.source,
    month: params.month,
    product: params.product?.trim(),
    requestScene: params.requestScene,
    problemType: params.problemType,
    complaintCauseL1: params.complaintCauseL1,
  })
}
