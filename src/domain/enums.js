/** @typedef {typeof DATA_SOURCE_TYPES[number]} DataSourceType */

/** 用户反馈数据来源（v2） */
export const DATA_SOURCE_TYPES = /** @type {const} */ ([
  'complaint_ticket',
  'consultation_ticket',
  'post_use_rating',
  'user_survey',
  'other',
])

/** @type {Record<DataSourceType, string>} */
export const DATA_SOURCE_LABELS = {
  complaint_ticket: '投诉工单',
  consultation_ticket: '咨询工单',
  post_use_rating: '用后即评',
  user_survey: '用户调研',
  other: '其他',
}

/** @typedef {typeof RECORD_STATUSES[number]} RecordStatus */
export const RECORD_STATUSES = /** @type {const} */ (['raw', 'analyzed', 'published'])

/** @typedef {typeof INSIGHT_PERIOD_STATUSES[number]} InsightPeriodStatus */
export const INSIGHT_PERIOD_STATUSES = /** @type {const} */ (['draft', 'active', 'archived'])

/** @typedef {typeof PERIOD_GRANULARITIES[number]} PeriodGranularity */
export const PERIOD_GRANULARITIES = /** @type {const} */ (['month', 'quarter', 'year', 'custom'])

/** @type {Record<PeriodGranularity, string>} */
export const PERIOD_GRANULARITY_LABELS = {
  month: '按月',
  quarter: '按季度',
  year: '按年',
  custom: '自定义',
}

/** @typedef {typeof ANALYSIS_RUN_STATUSES[number]} AnalysisRunStatus */
export const ANALYSIS_RUN_STATUSES = /** @type {const} */ ([
  'queued',
  'running',
  'succeeded',
  'partial_failed',
  'failed',
  'cancelled',
])

/** @typedef {typeof SNAPSHOT_STATUSES[number]} SnapshotStatus */
export const SNAPSHOT_STATUSES = /** @type {const} */ ([
  'ready',
  'stale',
  'rebuilding',
  'failed',
])

/** @typedef {typeof TAG_CANDIDATE_STATUSES[number]} TagCandidateStatus */
export const TAG_CANDIDATE_STATUSES = /** @type {const} */ ([
  'pending',
  'approved',
  'rejected',
  'merged',
])

/** @typedef {typeof TAG_TYPES[number]} TagType */
export const TAG_TYPES = /** @type {const} */ ([
  'request_scene',
  'problem_type',
  'journey_l1',
  'journey_l2',
  'theme',
])

/**
 * @param {string} value
 * @returns {value is DataSourceType}
 */
export function isDataSourceType(value) {
  return DATA_SOURCE_TYPES.includes(/** @type {DataSourceType} */ (value))
}
