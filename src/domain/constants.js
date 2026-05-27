/** v2 数据契约版本（NFR-R-041） */
export const SCHEMA_VERSION = '2.0'

/** 默认租户（MVP 本地） */
export const DEFAULT_TENANT_ID = 'local'

/** 默认洞察周期（v1 迁移 / 未指定时） */
export const LEGACY_INSIGHT_PERIOD_ID = 'legacy-default'

/** IndexedDB 数据库名 */
export const IDB_NAME = 'feedback-insights-v2'

/** IndexedDB schema 版本（object store 结构变更时递增） */
export const IDB_SCHEMA_VERSION = 2

/** 当前流水线版本（Ticket 分析包裹 v1 pipeline） */
export const PIPELINE_VERSION_TICKET = 'ticket-1.0.0'

/** 默认标签库版本（静态 taxonomy 未版本化前） */
export const TAG_LIBRARY_VERSION_DEFAULT = 'taxonomy-static-1'
