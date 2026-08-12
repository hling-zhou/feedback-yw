import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import {
  DISSATISFIED_REASON_ANALYSIS_DIM_KEYS,
  SATISFACTION_CALLBACK_REPORT_COLUMNS,
} from '../domain/followUpSatisfaction.js'
import {
  EMPTY_FILTER_TOKEN,
  FOLLOW_UP_FILTER_OPTIONS,
  FOLLOW_UP_RESOLVED_FILTER_OPTIONS,
} from './feedbackFilters.js'
import { MY_REVIEW_FILTER_OPTIONS } from '../domain/userTicketReview.js'
import { TICKET_LLM_FILTER_OPTIONS } from './ticketAnalysis/ticketAnalysisSources.js'
import { TODO_STATUS_FILTER_OPTIONS, LISTENING_REVIEWED_FILTER_OPTIONS } from './feedbackFilters.js'

/** @typedef {import('./feedbackFilters.js').FollowUpFilterValue} FollowUpFilterValue */
/** @typedef {import('./feedbackFilters.js').FollowUpResolvedFilterValue} FollowUpResolvedFilterValue */

/**
 * @typedef {Object} FeedbackFilterValues
 * @property {string[]} ticketIds
 * @property {string[]} customerNames
 * @property {string | null} ticketDateFrom
 * @property {string | null} ticketDateTo
 * @property {string} dataSource
 * @property {string} product
 * @property {string} problemType
 * @property {string} complaintCauseL1
 * @property {string} journeyL1
 * @property {string} resourcePool
 * @property {string} requestScene
 * @property {string} ticketLlm
 * @property {FollowUpFilterValue | ''} followUp
 * @property {FollowUpResolvedFilterValue | ''} followUpResolved
 * @property {string} reasonDim
 * @property {import('../domain/userTicketReview.js').MyReviewFilterValue} myReview
 * @property {import('./feedbackFilters.js').TodoStatusFilterValue | ''} todoStatus
 * @property {import('./feedbackFilters.js').ListeningReviewedFilterValue} listeningReviewed
 * @property {string} handlingKeyword
 */

/** @typedef {keyof FeedbackFilterValues} FeedbackFilterKey */

export const FEEDBACK_FILTER_KEYS = /** @type {FeedbackFilterKey[]} */ ([
  'ticketIds',
  'customerNames',
  'handlingKeyword',
  'ticketDateFrom',
  'ticketDateTo',
  'dataSource',
  'product',
  'problemType',
  'complaintCauseL1',
  'journeyL1',
  'resourcePool',
  'requestScene',
  'ticketLlm',
  'followUp',
  'followUpResolved',
  'reasonDim',
  'myReview',
  'todoStatus',
  'listeningReviewed',
])

/** @type {{ label: string; keys: FeedbackFilterKey[] }[]} */
export const FEEDBACK_FILTER_GROUPS = [
  {
    label: '工单',
    keys: ['ticketIds', 'customerNames', 'handlingKeyword', 'ticketDateFrom', 'dataSource'],
  },
  {
    label: '打标维度',
    keys: ['problemType', 'complaintCauseL1', 'journeyL1', 'resourcePool', 'requestScene'],
  },
  {
    label: '会议跟进',
    keys: ['todoStatus', 'listeningReviewed'],
  },
  {
    label: '分析增强',
    keys: ['ticketLlm'],
  },
  {
    label: '回访满意度',
    keys: ['followUp', 'followUpResolved'],
  },
  {
    label: '我的复核',
    keys: ['myReview'],
  },
]

/** @type {Record<FeedbackFilterKey, string>} */
export const FEEDBACK_FILTER_LABELS = {
  ticketIds: '工单号',
  customerNames: '客户名称',
  handlingKeyword: '工单内容',
  ticketDateFrom: '工单日期',
  ticketDateTo: '工单日期',
  dataSource: '数据来源',
  product: '产品',
  problemType: '问题类型',
  complaintCauseL1: '投诉原因（终判）',
  journeyL1: '用户旅程',
  resourcePool: '资源池',
  requestScene: '请求场景',
  ticketLlm: 'LLM 增强进度',
  followUp: '回访',
  followUpResolved: '解决状态',
  reasonDim: '不满意原因',
  myReview: '我的处理状态',
  todoStatus: '会议待办',
  listeningReviewed: '是否听音',
}

/** @returns {FeedbackFilterValues} */
export function createEmptyFeedbackFilters() {
  return {
    ticketIds: [],
    customerNames: [],
    ticketDateFrom: null,
    ticketDateTo: null,
    dataSource: '',
    product: '',
    problemType: '',
    complaintCauseL1: '',
    journeyL1: '',
    resourcePool: '',
    requestScene: '',
    ticketLlm: '',
    followUp: '',
    followUpResolved: '',
    reasonDim: '',
    myReview: '',
    todoStatus: '',
    listeningReviewed: '',
    handlingKeyword: '',
  }
}

/**
 * @param {FeedbackFilterValues} values
 * @param {FeedbackFilterKey} key
 */
export function isFeedbackFilterActive(values, key) {
  switch (key) {
    case 'ticketIds':
      return values.ticketIds.length > 0
    case 'customerNames':
      return values.customerNames.length > 0
    case 'ticketDateFrom':
    case 'ticketDateTo':
      return Boolean(values.ticketDateFrom || values.ticketDateTo)
    case 'followUp':
    case 'followUpResolved':
    case 'reasonDim':
    case 'dataSource':
    case 'product':
    case 'problemType':
    case 'complaintCauseL1':
    case 'journeyL1':
    case 'resourcePool':
    case 'requestScene':
    case 'ticketLlm':
    case 'myReview':
    case 'todoStatus':
    case 'listeningReviewed':
    case 'handlingKeyword':
      return Boolean(String(values[key] ?? '').trim())
    default:
      return false
  }
}

/**
 * @param {FeedbackFilterValues} values
 */
export function listActiveFeedbackFilterChipKeys(values) {
  /** @type {FeedbackFilterKey[]} */
  const keys = []
  if (isFeedbackFilterActive(values, 'ticketIds')) keys.push('ticketIds')
  if (isFeedbackFilterActive(values, 'customerNames')) keys.push('customerNames')
  if (isFeedbackFilterActive(values, 'handlingKeyword')) keys.push('handlingKeyword')
  if (isFeedbackFilterActive(values, 'ticketDateFrom')) keys.push('ticketDateFrom')
  if (values.dataSource) keys.push('dataSource')
  if (values.problemType) keys.push('problemType')
  if (values.complaintCauseL1) keys.push('complaintCauseL1')
  if (values.journeyL1) keys.push('journeyL1')
  if (values.resourcePool) keys.push('resourcePool')
  if (values.requestScene) keys.push('requestScene')
  if (values.ticketLlm) keys.push('ticketLlm')
  if (values.followUp) keys.push('followUp')
  if (values.followUpResolved) keys.push('followUpResolved')
  if (values.myReview) keys.push('myReview')
  if (values.todoStatus) keys.push('todoStatus')
  if (values.listeningReviewed) keys.push('listeningReviewed')
  return keys
}

/**
 * @param {FeedbackFilterValues} values
 */
export function countActiveFeedbackFilters(values) {
  return listActiveFeedbackFilterChipKeys(values).length
}

/**
 * @param {FeedbackFilterKey} key
 * @param {FeedbackFilterValues} values
 */
export function formatFeedbackFilterChipLabel(key, values) {
  switch (key) {
    case 'ticketIds':
      return values.ticketIds.length === 1
        ? values.ticketIds[0]
        : `${values.ticketIds.length} 个`
    case 'customerNames':
      return values.customerNames.length === 1
        ? values.customerNames[0]
        : `${values.customerNames.length} 个`
    case 'handlingKeyword': {
      const keyword = String(values.handlingKeyword ?? '').trim()
      return keyword.length > 24 ? `${keyword.slice(0, 24)}…` : keyword
    }
    case 'ticketDateFrom': {
      const from = values.ticketDateFrom || '…'
      const to = values.ticketDateTo || '…'
      return `${from} ~ ${to}`
    }
    case 'dataSource':
      return DATA_SOURCE_LABELS[values.dataSource] || values.dataSource
    case 'problemType':
      return values.problemType === EMPTY_FILTER_TOKEN ? '未分类' : values.problemType
    case 'requestScene':
      return values.requestScene === EMPTY_FILTER_TOKEN ? '未分类' : values.requestScene
    case 'ticketLlm':
      return TICKET_LLM_FILTER_OPTIONS.find((item) => item.value === values.ticketLlm)?.label || values.ticketLlm
    case 'followUp':
      return FOLLOW_UP_FILTER_OPTIONS.find((item) => item.value === values.followUp)?.label || values.followUp
    case 'followUpResolved':
      return (
        FOLLOW_UP_RESOLVED_FILTER_OPTIONS.find((item) => item.value === values.followUpResolved)?.label ||
        values.followUpResolved
      )
    case 'reasonDim':
      return REASON_DIM_OPTIONS.find((item) => item.value === values.reasonDim)?.label || values.reasonDim
    case 'myReview':
      return MY_REVIEW_FILTER_OPTIONS.find((item) => item.value === values.myReview)?.label || values.myReview
    case 'todoStatus':
      return (
        TODO_STATUS_FILTER_OPTIONS.find((item) => item.value === values.todoStatus)?.label ||
        values.todoStatus
      )
    case 'listeningReviewed':
      return (
        LISTENING_REVIEWED_FILTER_OPTIONS.find((item) => item.value === values.listeningReviewed)?.label ||
        values.listeningReviewed
      )
    default:
      return String(values[key] ?? '')
  }
}

/** @type {{ label: string; value: string }[]} */
export const REASON_DIM_OPTIONS = DISSATISFIED_REASON_ANALYSIS_DIM_KEYS.map((key) => ({
  value: key,
  label: SATISFACTION_CALLBACK_REPORT_COLUMNS[key],
}))

/**
 * @param {FeedbackFilterKey} key
 * @param {FeedbackFilterValues} values
 * @param {{ showComplaintCause?: boolean; hasProduct?: boolean; followUpActive?: boolean }} [ctx]
 */
export function isFeedbackFilterAddDisabled(key, values, ctx = {}) {
  if (isFeedbackFilterActive(values, key)) return true
  if (key === 'complaintCauseL1' && ctx.showComplaintCause === false) return true
  if (key === 'followUpResolved' && (!values.followUp || values.followUp === 'none')) return true
  if (key === 'ticketDateTo') return true
  return false
}

/**
 * @param {FeedbackFilterKey} key
 * @param {FeedbackFilterValues} values
 * @param {{ showComplaintCause?: boolean; followUpActive?: boolean }} [ctx]
 * @returns {string | undefined}
 */
export function getFeedbackFilterAddDisabledReason(key, values, ctx = {}) {
  if (isFeedbackFilterActive(values, key)) return '已添加该筛选条件'
  if (key === 'complaintCauseL1' && ctx.showComplaintCause === false) {
    return '请先选择数据来源「投诉工单」，或清空来源筛选'
  }
  if (key === 'followUpResolved' && (!values.followUp || values.followUp === 'none')) {
    return '请先选择「回访」筛选条件'
  }
  if (key === 'ticketDateTo') return '请使用「工单日期」设置范围'
  return undefined
}

/**
 * @param {FeedbackFilterKey} key
 */
export function normalizeFeedbackFilterEditorKey(key) {
  if (key === 'ticketDateTo') return 'ticketDateFrom'
  return key
}

/**
 * @param {FeedbackFilterKey} key
 * @param {Partial<FeedbackFilterValues>} patch
 * @param {FeedbackFilterValues} current
 * @returns {FeedbackFilterValues}
 */
export function applyFeedbackFilterPatch(key, patch, current) {
  const next = { ...current, ...patch }
  if (key === 'dataSource' && patch.dataSource && patch.dataSource !== 'complaint_ticket') {
    next.complaintCauseL1 = ''
  }
  if (key === 'product' && 'product' in patch) {
    next.resourcePool = ''
    next.journeyL1 = ''
  }
  if (key === 'followUp' && patch.followUp && (patch.followUp === 'none' || !patch.followUp)) {
    next.followUpResolved = ''
    next.reasonDim = ''
  }
  return next
}

/**
 * @param {FeedbackFilterKey} key
 * @param {FeedbackFilterValues} current
 * @returns {FeedbackFilterValues}
 */
export function clearFeedbackFilterKey(key, current) {
  /** @type {Partial<FeedbackFilterValues>} */
  const patch = {}
  switch (key) {
    case 'ticketIds':
      patch.ticketIds = []
      break
    case 'customerNames':
      patch.customerNames = []
      break
    case 'ticketDateFrom':
      patch.ticketDateFrom = null
      patch.ticketDateTo = null
      break
    case 'ticketDateTo':
      patch.ticketDateTo = null
      break
    default:
      patch[key] = ''
      break
  }
  return applyFeedbackFilterPatch(key, patch, current)
}

/** @returns {FeedbackFilterValues} */
export function clearAllFeedbackFilters() {
  return createEmptyFeedbackFilters()
}

/**
 * @param {FeedbackFilterValues} filters
 * @returns {Record<string, string>}
 */
export function feedbackFiltersToUrlPatch(filters) {
  return {
    product: filters.product,
    problemType: filters.problemType,
    complaintCauseL1: filters.complaintCauseL1,
    journeyL1: filters.journeyL1,
    requestScene: filters.requestScene,
    source: filters.dataSource,
    followUp: filters.followUp,
    followUpResolved: filters.followUpResolved,
    reasonDim: filters.reasonDim,
    ticketDateFrom: filters.ticketDateFrom || '',
    ticketDateTo: filters.ticketDateTo || '',
    ticketIds: filters.ticketIds.length ? filters.ticketIds.join(',') : '',
    customerNames: filters.customerNames.length ? filters.customerNames.join(',') : '',
    handlingKeyword: filters.handlingKeyword,
    myReview: filters.myReview,
    todoStatus: filters.todoStatus,
    listeningReviewed: filters.listeningReviewed,
  }
}

/**
 * @param {Partial<FeedbackFilterValues>} parsed
 * @returns {FeedbackFilterValues}
 */
export function feedbackFiltersFromParsed(parsed) {
  return {
    ...createEmptyFeedbackFilters(),
    ...parsed,
    ticketIds: parsed.ticketIds || [],
    customerNames: parsed.customerNames || [],
  }
}
