import dayjs from 'dayjs'
import { DATA_SOURCE_LABELS, DATA_SOURCE_TYPES } from '../domain/enums.js'
import {
  FOLLOW_UP_FILTER_OPTIONS,
  FOLLOW_UP_RESOLVED_FILTER_OPTIONS,
  LISTENING_REVIEWED_FILTER_OPTIONS,
  TODO_STATUS_FILTER_OPTIONS,
} from './feedbackFilters.js'
import { MY_REVIEW_FILTER_OPTIONS } from '../domain/userTicketReview.js'
import { TICKET_LLM_FILTER_OPTIONS } from './ticketAnalysis/ticketAnalysisSources.js'

/** @typedef {import('./feedbackFilterModel.js').FeedbackFilterKey} FeedbackFilterKey */
/** @typedef {import('./feedbackFilterModel.js').FeedbackFilterValues} FeedbackFilterValues */

/** @typedef {'enum' | 'dateRange' | 'multiSearch' | 'text'} FeedbackFilterEditorKind */

/** @type {Record<FeedbackFilterKey, FeedbackFilterEditorKind>} */
export const FEEDBACK_FILTER_EDITOR_KIND = {
  ticketIds: 'multiSearch',
  customerNames: 'multiSearch',
  handlingKeyword: 'text',
  ticketDateFrom: 'dateRange',
  ticketDateTo: 'dateRange',
  dataSource: 'enum',
  product: 'enum',
  problemType: 'enum',
  complaintCauseL1: 'enum',
  journeyL1: 'enum',
  resourcePool: 'enum',
  requestScene: 'enum',
  ticketLlm: 'enum',
  followUp: 'enum',
  followUpResolved: 'enum',
  reasonDim: 'enum',
  myReview: 'enum',
  todoStatus: 'enum',
  listeningReviewed: 'enum',
}

/**
 * @param {FeedbackFilterKey} key
 * @returns {FeedbackFilterEditorKind}
 */
export function getFeedbackFilterEditorKind(key) {
  return FEEDBACK_FILTER_EDITOR_KIND[key] || 'enum'
}

/**
 * @param {FeedbackFilterKey} filterKey
 * @param {FeedbackFilterValues} filters
 */
export function readFilterDraftValue(filterKey, filters) {
  switch (filterKey) {
    case 'ticketIds':
      return [...filters.ticketIds]
    case 'customerNames':
      return [...filters.customerNames]
    case 'ticketDateFrom':
      return [
        filters.ticketDateFrom ? dayjs(filters.ticketDateFrom) : null,
        filters.ticketDateTo ? dayjs(filters.ticketDateTo) : null,
      ]
    default:
      return filters[filterKey]
  }
}

/**
 * @param {FeedbackFilterKey} filterKey
 * @param {unknown} draft
 * @returns {Partial<FeedbackFilterValues>}
 */
export function buildFilterPatchFromDraft(filterKey, draft) {
  switch (filterKey) {
    case 'ticketIds':
    case 'customerNames':
      return {
        [filterKey]: Array.isArray(draft)
          ? [...new Set(draft.map((item) => String(item).trim()).filter(Boolean))]
          : [],
      }
    case 'handlingKeyword':
      return { handlingKeyword: String(draft ?? '').trim() }
    case 'ticketDateFrom': {
      const range = /** @type {[import('dayjs').Dayjs | null, import('dayjs').Dayjs | null] | null} */ (
        draft
      )
      return {
        ticketDateFrom: range?.[0]?.format('YYYY-MM-DD') || null,
        ticketDateTo: range?.[1]?.format('YYYY-MM-DD') || null,
      }
    }
    default:
      return { [filterKey]: draft ?? '' }
  }
}

/**
 * @param {FeedbackFilterKey} filterKey
 * @param {unknown} draft
 */
export function isFilterDraftValid(filterKey, draft) {
  switch (filterKey) {
    case 'ticketIds':
    case 'customerNames':
      return Array.isArray(draft) && draft.length > 0
    case 'ticketDateFrom':
      return Boolean(Array.isArray(draft) && (draft[0] || draft[1]))
    default:
      return Boolean(String(draft ?? '').trim())
  }
}

/**
 * @param {FeedbackFilterKey} filterKey
 * @param {FeedbackFilterValues} filters
 * @param {Object} options
 * @param {boolean} showComplaintCauseFilter
 */
export function listEnumOptionsForFilterKey(filterKey, filters, options, showComplaintCauseFilter) {
  switch (filterKey) {
    case 'ticketIds':
      return options.ticketIdOptions || []
    case 'customerNames':
      return options.customerNameOptions || []
    case 'dataSource':
      return (options.dataSourceTypes || DATA_SOURCE_TYPES).map((type) => ({
        label: DATA_SOURCE_LABELS[type],
        value: type,
      }))
    case 'product':
      return (options.products || []).map((item) => ({ label: item.name, value: item.name }))
    case 'problemType':
      return (options.problemTypes || []).map((item) => ({ label: item.name, value: item.name }))
    case 'complaintCauseL1':
      return showComplaintCauseFilter
        ? (options.complaintCauseOptions || []).map((item) => ({
            label: item.name,
            value: item.name,
          }))
        : []
    case 'journeyL1':
      return (options.journeys || []).map((item) => ({ label: item.name, value: item.name }))
    case 'resourcePool':
      return (options.resourcePools || []).map((item) => ({ label: item.name, value: item.name }))
    case 'requestScene':
      return (options.requestScenes || []).map((item) => ({ label: item.name, value: item.name }))
    case 'ticketLlm':
      return TICKET_LLM_FILTER_OPTIONS.filter((item) => item.value).map((item) => ({
        label: item.label,
        value: item.value,
        title: item.title,
      }))
    case 'followUp':
      return FOLLOW_UP_FILTER_OPTIONS.filter((item) => item.value)
    case 'followUpResolved':
      return filters.followUp && filters.followUp !== 'none'
        ? FOLLOW_UP_RESOLVED_FILTER_OPTIONS.filter((item) => item.value)
        : []
    case 'reasonDim':
      return options.reasonDimOptions || []
    case 'myReview':
      return MY_REVIEW_FILTER_OPTIONS.filter((item) => item.value).map((item) => ({
        label: item.label,
        value: item.value,
      }))
    case 'todoStatus':
      return TODO_STATUS_FILTER_OPTIONS.filter((item) => item.value)
    case 'listeningReviewed':
      return LISTENING_REVIEWED_FILTER_OPTIONS.filter((item) => item.value)
    default:
      return []
  }
}
