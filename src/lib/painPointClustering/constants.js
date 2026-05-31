/** @typedef {import('../../domain/enums.js').DataSourceType} DataSourceType */

export const CLUSTERING_VERSION = 'v2.0'

/** 一次聚类 Jaccard 层次聚类切分阈值 */
export const PRIMARY_CLUSTER_THRESHOLD = 0.3

/** 二次聚类阈值 */
export const SECONDARY_CLUSTER_THRESHOLD = 0.2

/** 每产品最终群组 Top N */
export const FINAL_CLUSTER_TOP_N = 10

/** 簇最小工单数（一次聚类） */
export const PRIMARY_MIN_CLUSTER_SIZE = 2

/** 单组 unique 数超过此值时记录 diagnostics 告警（M1） */
export const PRIMARY_CLUSTER_MAX_ITEMS = 150

/** 不参与二次聚类的问题类型（取群组多数票） */
export const LOW_VALUE_PROBLEM_TYPES = new Set(['配额与权限申请', '其他'])

/**
 * 附录 A：问题类型 → 基准严重度（0~5）
 * @type {Record<string, number>}
 */
export const PROBLEM_TYPE_SEVERITY = {
  '可用性/连通性故障': 5,
  性能问题: 4,
  计费与账单: 5,
  配额与权限申请: 1,
  资源开通与创建: 5,
  配置与操作: 5,
  退订与释放: 5,
  界面与操作易用性: 3,
  产品功能需求: 3,
  产品功能咨询: 2,
  人工服务与流程: 1,
  其他: 0,
}

/**
 * 附录 B：情绪分类基础分
 * @type {Record<string, number>}
 */
export const EMOTION_BASE_SCORE = {
  positive: 1,
  neutral_inquiry: 1,
  neutral_pending: 2,
  mild_negative: 3,
  negative: 4,
  strong_negative: 5,
}

export const URGENCY_BONUS = 0.5
export const EMOTION_SCORE_MAX = 5

/** 参与聚类的工单来源（可扩展） */
export const CLUSTERING_DATA_SOURCES = /** @type {DataSourceType[]} */ ([
  'complaint_ticket',
  'consultation_ticket',
])

/** @type {Record<DataSourceType, string>} */
export const DATA_SOURCE_SHORT_LABEL = {
  complaint_ticket: '投诉',
  consultation_ticket: '咨询',
  post_use_rating: '用后即评',
  user_survey: '调研',
  other: '其他',
}
