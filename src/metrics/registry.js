/** @typedef {import('../domain/enums.js').DataSourceType} DataSourceType */

/**
 * @typedef {Object} MetricDescriptor
 * @property {string} id
 * @property {string} label
 * @property {boolean} comparableAcrossSources
 * @property {DataSourceType[]} allowedSources
 * @property {'sum' | 'avg' | 'distribution' | 'none'} aggregation
 */

/** @type {MetricDescriptor[]} */
export const METRIC_DESCRIPTORS = [
  {
    id: 'record_count',
    label: '反馈条数',
    comparableAcrossSources: true,
    allowedSources: [
      'complaint_ticket',
      'consultation_ticket',
      'post_use_rating',
      'user_survey',
      'other',
    ],
    aggregation: 'sum',
  },
  {
    id: 'sentiment_distribution',
    label: '情绪分布',
    comparableAcrossSources: false,
    allowedSources: ['complaint_ticket', 'consultation_ticket'],
    aggregation: 'distribution',
  },
  {
    id: 'problem_type_top',
    label: '问题类型 Top',
    comparableAcrossSources: false,
    allowedSources: ['complaint_ticket', 'consultation_ticket'],
    aggregation: 'distribution',
  },
  {
    id: 'journey_l1_top',
    label: '用户旅程一级 Top',
    comparableAcrossSources: false,
    allowedSources: ['complaint_ticket', 'consultation_ticket'],
    aggregation: 'distribution',
  },
  {
    id: 'monthly_trend',
    label: '月度趋势',
    comparableAcrossSources: true,
    allowedSources: ['complaint_ticket', 'consultation_ticket', 'post_use_rating'],
    aggregation: 'distribution',
  },
  {
    id: 'product_distribution',
    label: '产品分布',
    comparableAcrossSources: true,
    allowedSources: [
      'complaint_ticket',
      'consultation_ticket',
      'post_use_rating',
      'user_survey',
      'other',
    ],
    aggregation: 'distribution',
  },
  {
    id: 'rating_avg',
    label: '平均评分',
    comparableAcrossSources: false,
    allowedSources: ['post_use_rating'],
    aggregation: 'avg',
  },
  {
    id: 'survey_response_count',
    label: '调研作答数',
    comparableAcrossSources: false,
    allowedSources: ['user_survey'],
    aggregation: 'sum',
  },
  {
    id: 'wan_tou_ratio',
    label: '万投比',
    comparableAcrossSources: false,
    allowedSources: ['complaint_ticket'],
    aggregation: 'avg',
  },
]

/** @returns {MetricDescriptor[]} */
export function listMetricDescriptors() {
  return METRIC_DESCRIPTORS
}

/** @returns {MetricDescriptor[]} */
export function getComparableMetrics() {
  return METRIC_DESCRIPTORS.filter((m) => m.comparableAcrossSources)
}

/**
 * @param {DataSourceType} source
 * @returns {MetricDescriptor[]}
 */
export function getMetricsForSource(source) {
  return METRIC_DESCRIPTORS.filter((m) => m.allowedSources.includes(source))
}

/**
 * @param {string} id
 * @returns {MetricDescriptor | undefined}
 */
export function getMetricById(id) {
  return METRIC_DESCRIPTORS.find((m) => m.id === id)
}
