/** @typedef {import('./enums.js').DataSourceType} DataSourceType */

export const POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE = /** @type {const} */ ('channel_bundle')
export const POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK = /** @type {const} */ (
  'satisfaction_callback'
)
export const POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT = /** @type {const} */ ('customer_visit')

/** @typedef {typeof POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE | typeof POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK | typeof POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT} PostUseRatingImportSubType */

export const POST_USE_RATING_SUBTYPE_OPTIONS = [
  { value: POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE, label: '短信渠道+官网渠道 用户反馈' },
  { value: POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT, label: '客服部回访导入' },
]

export const FEEDBACK_LANE_POST_USE = /** @type {const} */ ('post_use')
export const FEEDBACK_LANE_TICKETS = /** @type {const} */ ('tickets')
export const FEEDBACK_LANE_CUSTOMER_VISITS = /** @type {const} */ ('customer_visits')

export const FEEDBACK_LANE_DATA_SOURCES = {
  [FEEDBACK_LANE_TICKETS]: ['complaint_ticket', 'consultation_ticket'],
  [FEEDBACK_LANE_POST_USE]: ['post_use_rating'],
  [FEEDBACK_LANE_CUSTOMER_VISITS]: [],
}

/** 用后即评满意度大类提示：不含已挂到投诉/咨询工单的回访 */
export const POST_USE_LANE_HINT =
  '不含已关联到投诉/咨询工单的投诉回访；请到「投诉咨询工单」查看回访满意度。'

/**
 * @param {DataSourceType} dataSourceType
 * @param {PostUseRatingImportSubType} [postUseRatingSubType]
 */
export function isFollowUpSatisfactionImport(dataSourceType, postUseRatingSubType) {
  return (
    dataSourceType === 'post_use_rating' &&
    postUseRatingSubType === POST_USE_RATING_SUBTYPE_SATISFACTION_CALLBACK
  )
}

/**
 * @param {DataSourceType} dataSourceType
 * @param {PostUseRatingImportSubType} [postUseRatingSubType]
 */
export function isPostUseChannelBundleImport(dataSourceType, postUseRatingSubType) {
  return (
    dataSourceType === 'post_use_rating' &&
    postUseRatingSubType === POST_USE_RATING_SUBTYPE_CHANNEL_BUNDLE
  )
}

/**
 * @param {DataSourceType} dataSourceType
 * @param {PostUseRatingImportSubType} [postUseRatingSubType]
 */
export function isCustomerVisitImport(dataSourceType, postUseRatingSubType) {
  return (
    dataSourceType === 'post_use_rating' &&
    postUseRatingSubType === POST_USE_RATING_SUBTYPE_CUSTOMER_VISIT
  )
}

/**
 * 是否为用后即评记录
 * @param {{ dataSourceType?: string } | null | undefined} record
 */
export function isPostUseRatingRecord(record) {
  return record?.dataSourceType === 'post_use_rating'
}

/**
 * 投诉回访独立明细：指标可含 callback，反馈库/用后即评列表不应再呈现
 * （回访已挂在投诉/咨询工单的 followUpSatisfaction 上）
 * @param {{ dataSourceType?: string; channel?: string; sourceSubType?: string } | null | undefined} record
 */
export function isPostUseRatingCallbackRecord(record) {
  if (!record) return false
  if (record.channel === 'callback' || record.sourceSubType === 'satisfaction_callback') {
    // 兼容：仅 channel/subType 命中且确认为用后即评，或未标 dataSourceType 的遗留行
    return !record.dataSourceType || record.dataSourceType === 'post_use_rating'
  }
  return false
}

/**
 * 反馈库可见的用后即评渠道明细（短信/控制台；不含投诉回访）
 * @param {{ dataSourceType?: string; channel?: string; sourceSubType?: string } | null | undefined} record
 */
export function isPostUseRatingLibraryRecord(record) {
  return isPostUseRatingRecord(record) && !isPostUseRatingCallbackRecord(record)
}

/**
 * 反馈库用后即评非 10 分明细（可补用户旅程）
 * @param {{ dataSourceType?: string; channel?: string; sourceSubType?: string; ratingScore?: number | string | null } | null | undefined} record
 */
export function isPostUseNon10LibraryRecord(record) {
  if (!isPostUseRatingLibraryRecord(record)) return false
  const score = Number(record?.ratingScore)
  return Number.isFinite(score) && score < 10
}

/**
 * 从 URLSearchParams / lane 字符串 / { lane, source } 解析反馈库大类
 * @param {string | URLSearchParams | { get?: (k: string) => string | null; lane?: string; source?: string } | null | undefined} searchParamsOrLane
 * @returns {typeof FEEDBACK_LANE_POST_USE | typeof FEEDBACK_LANE_TICKETS | typeof FEEDBACK_LANE_CUSTOMER_VISITS}
 */
export function resolveFeedbackLane(searchParamsOrLane) {
  if (searchParamsOrLane == null) return FEEDBACK_LANE_TICKETS

  if (typeof searchParamsOrLane === 'string') {
    const s = searchParamsOrLane.trim()
    if (s === FEEDBACK_LANE_POST_USE || s === 'post_use_rating') return FEEDBACK_LANE_POST_USE
    if (s === FEEDBACK_LANE_CUSTOMER_VISITS || s === 'customer_visit') {
      return FEEDBACK_LANE_CUSTOMER_VISITS
    }
    return FEEDBACK_LANE_TICKETS
  }

  /** @type {(k: string) => string | null} */
  const get =
    typeof searchParamsOrLane.get === 'function'
      ? (k) => searchParamsOrLane.get(k)
      : (k) => {
          const v = /** @type {Record<string, unknown>} */ (searchParamsOrLane)[k]
          return v == null ? null : String(v)
        }

  const lane = String(get('lane') ?? '').trim()
  if (lane === FEEDBACK_LANE_POST_USE) return FEEDBACK_LANE_POST_USE
  if (lane === FEEDBACK_LANE_TICKETS) return FEEDBACK_LANE_TICKETS
  if (lane === FEEDBACK_LANE_CUSTOMER_VISITS) return FEEDBACK_LANE_CUSTOMER_VISITS

  const source = String(get('source') ?? '').trim()
  if (source === 'post_use_rating') return FEEDBACK_LANE_POST_USE

  return FEEDBACK_LANE_TICKETS
}

/**
 * @param {typeof FEEDBACK_LANE_POST_USE | typeof FEEDBACK_LANE_TICKETS | typeof FEEDBACK_LANE_CUSTOMER_VISITS} lane
 * @param {string | null | undefined} source
 */
export function normalizeFeedbackLaneDataSource(lane, source) {
  const value = String(source ?? '').trim()
  const allowed = FEEDBACK_LANE_DATA_SOURCES[lane] || FEEDBACK_LANE_DATA_SOURCES[FEEDBACK_LANE_TICKETS]
  if (allowed.includes(value)) return value
  return lane === FEEDBACK_LANE_POST_USE ? 'post_use_rating' : ''
}

/**
 * 反馈库大类分流的唯一口径。用后即评排除已挂回投诉/咨询工单的 callback 独立行。
 * @param {Array<{ dataSourceType?: string; channel?: string; sourceSubType?: string }>} records
 * @param {typeof FEEDBACK_LANE_POST_USE | typeof FEEDBACK_LANE_TICKETS} lane
 */
export function filterFeedbackRecordsForLane(records, lane) {
  if (lane === FEEDBACK_LANE_POST_USE) {
    return (records || []).filter(isPostUseRatingLibraryRecord)
  }
  return (records || []).filter(
    (record) =>
      record?.dataSourceType === 'complaint_ticket' ||
      record?.dataSourceType === 'consultation_ticket' ||
      !record?.dataSourceType,
  )
}

/**
 * @param {Array<{ dataSourceType?: string; channel?: string; sourceSubType?: string }>} records
 */
export function countFeedbackRecordsByLane(records) {
  return {
    tickets: filterFeedbackRecordsForLane(records, FEEDBACK_LANE_TICKETS).length,
    postUse: filterFeedbackRecordsForLane(records, FEEDBACK_LANE_POST_USE).length,
  }
}

/**
 * @param {string | undefined | null} importMonth YYYY-MM
 */
export function periodIdFromImportMonth(importMonth) {
  const s = String(importMonth ?? '').trim()
  return /^\d{4}-\d{2}$/.test(s) ? `period:month:${s}` : ''
}

/**
 * @param {string | undefined | null} importMonth
 * @param {import('./insightPeriod.js').InsightPeriod[]} periods
 */
export function resolvePeriodFromImportMonth(importMonth, periods) {
  const periodId = periodIdFromImportMonth(importMonth)
  if (!periodId) return null
  return periods.find((p) => p.id === periodId) ?? null
}
