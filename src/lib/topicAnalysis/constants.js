export const TOPIC_ANALYSIS_DEMO = true
export const TOPIC_ANALYSIS_DEMO_LABEL = 'Beta 版'
export const TOPIC_ANALYSIS_DEMO_NOTE =
  '专题分析目前为 Beta 版本。系统推荐默认看近 9 个月（近期 4 个月 vs 更早 5 个月）投诉/咨询/用后即评，且只纳入「产品与规格」中至少开启一项分析的产品；用后即评不含 10 分且无负面反馈的记录。只有新建专题时才指定周期，自定义专题不套这条满分过滤。本地补充材料（Markdown / Word / PDF / Excel）可在报告详情中提供。客户身份按名称或编码精确匹配。'

export const META_KEY_TOPIC_ANALYSIS_RUNS = 'topic_analysis_runs_v1'
export const META_KEY_TOPIC_ANALYSIS_REPORTS = 'topic_analysis_reports_v1'

/** @typedef {'customer' | 'product_issue' | 'common_issue'} TopicType */

export const TOPIC_TYPES = /** @type {const} */ (['customer', 'product_issue', 'common_issue'])

/** @type {Record<TopicType, string>} */
export const TOPIC_TYPE_LABELS = {
  customer: '客户专题',
  product_issue: '产品问题专题',
  common_issue: '共性问题专题',
}

export const MAX_TOPIC_RECOMMENDATIONS = 8
export const MAX_TOPIC_RECOMMEND_CANDIDATES = 12

/** @typedef {'chronic' | 'worsening' | 'emerging' | 'cross_product' | 'customer_persistent' | 'key_customer' | 'cross_source' | 'high_severity' | 'unresolved'} TopicScenario */

/** @type {Record<TopicScenario, string>} */
export const TOPIC_SCENARIO_LABELS = {
  chronic: '长期未解',
  worsening: '近期加重',
  emerging: '新出现',
  cross_product: '跨产品共性',
  customer_persistent: '客户持续负面',
  key_customer: '高价值客户',
  cross_source: '跨来源共振',
  high_severity: '强负向/加急',
  unresolved: '未闭环',
}
export const MAX_TOPIC_QUOTES = 8
export const MAX_TOPIC_SOURCES = 40
export const MAX_SAVED_TOPIC_RUNS = 12
export const MAX_EVIDENCE_SCAN = 400
export const MAX_SUPPLEMENT_TEXT = 12000

export const TOPIC_ORIGIN_LABELS = {
  recommended: '系统推荐',
  custom: '用户新建',
}

/** @typedef {'generating' | 'ready' | 'failed'} TopicReportStatus */

export const TOPIC_REPORT_STATUS_LABELS = {
  generating: '生成中',
  ready: '已生成',
  failed: '生成失败',
}

export function topicReportStatus(report) {
  return report?.status || 'ready'
}

export const SUPPLEMENT_ACCEPT = '.md,.markdown,.txt,.docx,.pdf,.xlsx,.xls'
