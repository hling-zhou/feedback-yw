/**
 * 举一反三问题（Generalization Issue）领域模型 —— 枚举、构建器与校验。
 * @see docs/DESIGN-20261102-1.md §2 数据模型、§3.1 判据、§5 前端
 *
 * 与留观（observationIssue.js）同模式但独立：三轨并列（留观=等、举措=治、举一反三=推）。
 */

import { randomId } from '../lib/randomId.js'

/** @typedef {'in_progress' | 'completed' | 'terminated'} GeneralizationIssueStatus */

/** @typedef {'confirmed' | 'pending_suggest' | 'dismissed'} GeneralizationLinkStatus */

/** @typedef {'manual' | 'auto_match' | 'auto_anchor'} GeneralizationLinkSource */

/** @typedef {'' | 'high' | 'medium' | 'low'} GeneralizationMatchConfidence */

/** @typedef {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} GeneralizationRecordDataSource */

/**
 * @typedef {Object} GeneralizationIssue
 * @property {string} id
 * @property {string} productKey
 * @property {string} productName
 * @property {GeneralizationIssueStatus} status - in_progress 参与自动匹配；completed/terminated 终态
 * @property {string} title
 * @property {string} summary - 问题描述（≤100 字）
 * @property {string} category - 可介入原因范畴（GENERALIZATION_CATEGORIES 六选一）
 * @property {string} scope - '' | multi_scenario | cross_product（判据 A 共性范围）
 * @property {string} rootCause - 根因分析（创建可空，Tab 侧滑编辑必填——v3.4）
 * @property {string} optimization - 优化方案（创建可空，Tab 侧滑编辑必填——v3.4；升级预填←举措内容）
 * @property {string} originActionId - 首个创建它的举措（仅视觉回链；多对一反查走 action_refs 表）
 * @property {number} occurrenceCount - 冗余计数；links(confirmed) 为真源
 * @property {string} firstSeenAt
 * @property {string} lastSeenAt
 * @property {{ keywords?: string[], notes?: string, categoryOther?: string }} [payload]
 * @property {string} createdBy
 * @property {string} createdAt
 */

/**
 * @typedef {Object} GeneralizationIssueLink
 * @property {string} id
 * @property {string} issueId
 * @property {string} recordId
 * @property {GeneralizationRecordDataSource} recordDataSource
 * @property {string} ticketId
 * @property {GeneralizationLinkStatus} linkStatus
 * @property {GeneralizationLinkSource} linkSource
 * @property {GeneralizationMatchConfidence} matchConfidence
 * @property {string} matchReason
 * @property {string} matchedExcerpt
 * @property {string} proposedAt
 * @property {string} reviewedBy
 * @property {string} reviewedAt
 * @property {string} createdAt
 */

/** @type {GeneralizationIssueStatus[]} */
export const GENERALIZATION_ISSUE_STATUSES = ['in_progress', 'completed', 'terminated']

/** @type {Record<GeneralizationIssueStatus, string>} */
export const GENERALIZATION_ISSUE_STATUS_LABELS = {
  in_progress: '进行中',
  completed: '已完成',
  terminated: '未完成终止',
}

/** @type {GeneralizationLinkStatus[]} */
export const GENERALIZATION_LINK_STATUSES = ['confirmed', 'pending_suggest', 'dismissed']

/** @type {Record<GeneralizationLinkStatus, string>} */
export const GENERALIZATION_LINK_STATUS_LABELS = {
  confirmed: '已确认',
  pending_suggest: '待复核',
  dismissed: '已否决',
}

/** @type {GeneralizationLinkSource[]} */
export const GENERALIZATION_LINK_SOURCES = ['manual', 'auto_match', 'auto_anchor']

/** @type {Record<GeneralizationLinkSource, string>} */
export const GENERALIZATION_LINK_SOURCE_LABELS = {
  manual: '人工',
  auto_match: '自动判别',
  auto_anchor: '锚点',
}

/** @type {Array<'high' | 'medium' | 'low'>} */
export const GENERALIZATION_MATCH_CONFIDENCES = ['high', 'medium', 'low']

/** @type {Record<'high' | 'medium' | 'low', string>} */
export const GENERALIZATION_MATCH_CONFIDENCE_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
}

/**
 * 可介入原因范畴（判据 B，设计 §2.3——需求原文 5 类 + 兜底；只选不造）。
 * @typedef {'code_logic' | 'special_scenario' | 'console_ux' | 'api_doc' | 'business_rule' | 'other_intervenable'} GeneralizationCategory
 */
/** @type {GeneralizationCategory[]} */
export const GENERALIZATION_CATEGORIES = [
  'code_logic',
  'special_scenario',
  'console_ux',
  'api_doc',
  'business_rule',
  'other_intervenable',
]

/** @type {Record<GeneralizationCategory, string>} */
export const GENERALIZATION_CATEGORY_LABELS = {
  code_logic: '编码逻辑不当',
  special_scenario: '功能在特殊场景下失效',
  console_ux: '控制台操作繁琐',
  api_doc: 'API 文档错误',
  business_rule: '业务规则设计不当',
  other_intervenable: '其他可介入原因',
}

/**
 * 范畴展示文案（11-04：「其他」带自定义说明时拼接展示——「其他：服务端配置默认值不合理」）。
 * @param {string} category - 范畴枚举值
 * @param {string} [categoryOther] - 「其他」的自定义补充说明（payload.categoryOther）
 * @returns {string}
 */
export function formatGeneralizationCategoryLabel(category, categoryOther) {
  const label = GENERALIZATION_CATEGORY_LABELS[category] || category || ''
  const other = String(categoryOther || '').trim()
  if (category === 'other_intervenable' && other) {
    return `其他：${other}`
  }
  return label
}

/**
 * 共性范围（判据 A——问题是否具备跨场景/跨产品共性，非单产品孤例）。
 * @typedef {'multi_scenario' | 'cross_product'} GeneralizationScope
 */
/** @type {GeneralizationScope[]} */
export const GENERALIZATION_SCOPES = ['multi_scenario', 'cross_product']

/** @type {Record<GeneralizationScope, string>} */
export const GENERALIZATION_SCOPE_LABELS = {
  multi_scenario: '多场景共性',
  cross_product: '跨产品共性',
}

/** 标题/问题描述上限（对齐留观口径：100 字） */
export const GENERALIZATION_SUMMARY_MAX_LENGTH = 100

/** 根因分析/优化方案上限（长文本，防滥用；非 100 字口径） */
export const GENERALIZATION_ROOT_CAUSE_MAX_LENGTH = 2000
export const GENERALIZATION_OPTIMIZATION_MAX_LENGTH = 2000

/** 依据标签 dedupe 键（UNIQUE(issue_id, record_id) 的应用层镜像，供校验提示） */
export const GENERALIZATION_LINK_DEDUPE_HINT = '同一条记录与同一举一反三问题只能有一条关联'

/**
 * @param {unknown} value
 * @returns {value is GeneralizationIssueStatus}
 */
export function isGeneralizationIssueStatus(value) {
  return GENERALIZATION_ISSUE_STATUSES.includes(/** @type {GeneralizationIssueStatus} */ (value))
}

/**
 * @param {unknown} value
 * @returns {value is GeneralizationLinkStatus}
 */
export function isGeneralizationLinkStatus(value) {
  return GENERALIZATION_LINK_STATUSES.includes(/** @type {GeneralizationLinkStatus} */ (value))
}

/**
 * @param {unknown} value
 * @returns {value is GeneralizationCategory}
 */
export function isGeneralizationCategory(value) {
  return GENERALIZATION_CATEGORIES.includes(/** @type {GeneralizationCategory} */ (value))
}

/**
 * @param {unknown} value
 * @returns {value is GeneralizationScope}
 */
export function isGeneralizationScope(value) {
  return GENERALIZATION_SCOPES.includes(/** @type {GeneralizationScope} */ (value))
}

/**
 * @param {unknown} value
 * @returns {value is GeneralizationRecordDataSource}
 */
export function isGeneralizationRecordDataSource(value) {
  return (
    value === 'complaint_ticket' ||
    value === 'consultation_ticket' ||
    value === 'post_use_rating'
  )
}

/**
 * 归一化举一反三 payload：keywords 去空去重（≤20）、notes 透传。
 * @param {unknown} value
 * @returns {GeneralizationIssue['payload']}
 */
export function normalizeGeneralizationPayload(value) {
  if (!value || typeof value !== 'object') return {}
  const raw = /** @type {Record<string, unknown>} */ (value)
  const out = /** @type {GeneralizationIssue['payload']} */ ({})
  if (Array.isArray(raw.keywords)) {
    const seen = new Set()
    out.keywords = raw.keywords
      .map((k) => String(k ?? '').trim())
      .filter((k) => {
        if (!k || seen.has(k)) return false
        seen.add(k)
        return true
      })
      .slice(0, 20)
  }
  if (typeof raw.notes === 'string' && raw.notes.trim()) out.notes = raw.notes.trim()
  // 「其他」范畴自定义说明（11-04 需求）：category=other_intervenable 时的补充文本
  if (typeof raw.categoryOther === 'string' && raw.categoryOther.trim()) {
    out.categoryOther = raw.categoryOther.trim().slice(0, 100)
  }
  return out
}

/**
 * 构建新举一反三问题（服务端/前端共用；id/createdAt 由此处补齐）。
 *
 * 创建口径（v3.4）：category/scope 必填（定义性属性）；root_cause/optimization
 * 允许空（各入口创建后到 Tab 侧滑补全，Tab 编辑保存时必填）。
 *
 * @param {{
 *   productKey?: string
 *   productName?: string
 *   title?: string
 *   summary?: string
 *   category?: string
 *   scope?: string
 *   rootCause?: string
 *   optimization?: string
 *   originActionId?: string
 *   keywords?: string[]
 *   notes?: string
 *   categoryOther?: string
 *   createdBy?: string
 * }} input
 * @returns {{ issue: GeneralizationIssue, errors: string[] }}
 */
export function buildGeneralizationIssueFromInput(input) {
  const errors = []
  const title = String(input?.title ?? '').trim()
  const summary = String(input?.summary ?? '').trim()
  const productName = String(input?.productName ?? '').trim()
  const productKey = String(input?.productKey ?? '').trim()
  const category = String(input?.category ?? '').trim()
  const scope = String(input?.scope ?? '').trim()
  const rootCause = String(input?.rootCause ?? '').trim()
  const optimization = String(input?.optimization ?? '').trim()
  if (!title) errors.push('问题标题不能为空')
  if (title.length > GENERALIZATION_SUMMARY_MAX_LENGTH) {
    errors.push(`标题不能超过 ${GENERALIZATION_SUMMARY_MAX_LENGTH} 字`)
  }
  if (!summary) errors.push('问题描述不能为空')
  if (summary.length > GENERALIZATION_SUMMARY_MAX_LENGTH) {
    errors.push(`问题描述不能超过 ${GENERALIZATION_SUMMARY_MAX_LENGTH} 字`)
  }
  if (!productName || !productKey) errors.push('产品不能为空')
  if (!isGeneralizationCategory(category)) {
    errors.push('可介入原因范畴必填（六选一）')
  }
  if (!isGeneralizationScope(scope)) {
    errors.push('共性范围必填（多场景共性 / 跨产品共性）')
  }
  // 创建允许空（Tab 编辑必填）；但给了值就限长
  if (rootCause.length > GENERALIZATION_ROOT_CAUSE_MAX_LENGTH) {
    errors.push(`根因分析不能超过 ${GENERALIZATION_ROOT_CAUSE_MAX_LENGTH} 字`)
  }
  if (optimization.length > GENERALIZATION_OPTIMIZATION_MAX_LENGTH) {
    errors.push(`优化方案不能超过 ${GENERALIZATION_OPTIMIZATION_MAX_LENGTH} 字`)
  }
  const issue = /** @type {GeneralizationIssue} */ ({
    id: randomId(),
    productKey,
    productName,
    status: 'in_progress',
    title,
    summary,
    category,
    scope,
    rootCause,
    optimization,
    originActionId: String(input?.originActionId ?? '').trim(),
    occurrenceCount: 0,
    firstSeenAt: '',
    lastSeenAt: '',
    payload: normalizeGeneralizationPayload({ keywords: input?.keywords, notes: input?.notes, categoryOther: input?.categoryOther }),
    createdBy: String(input?.createdBy ?? '').trim(),
    createdAt: new Date().toISOString(),
  })
  return { issue, errors }
}

/**
 * 构建关联证据 link（对齐 observation link 构建器语义）。
 *
 * @param {{
 *   issueId?: string
 *   recordId?: string
 *   recordDataSource?: string
 *   ticketId?: string
 *   linkStatus?: string
 *   linkSource?: string
 *   matchConfidence?: string
 *   matchReason?: string
 *   matchedExcerpt?: string
 *   proposedAt?: string
 *   reviewedBy?: string
 *   reviewedAt?: string
 * }} input
 * @returns {{ link: GeneralizationIssueLink, errors: string[] }}
 */
export function buildGeneralizationLinkFromInput(input) {
  const errors = []
  const issueId = String(input?.issueId ?? '').trim()
  const recordId = String(input?.recordId ?? '').trim()
  if (!issueId) errors.push('issueId 不能为空')
  if (!recordId) errors.push('recordId 不能为空')

  const linkStatus = isGeneralizationLinkStatus(input?.linkStatus)
    ? input.linkStatus
    : 'confirmed'
  const linkSource = GENERALIZATION_LINK_SOURCES.includes(
    /** @type {GeneralizationLinkSource} */ (input?.linkSource),
  )
    ? /** @type {GeneralizationLinkSource} */ (input?.linkSource)
    : 'manual'

  if (linkStatus === 'pending_suggest' && !isGeneralizationRecordDataSource(input?.recordDataSource)) {
    errors.push('自动建议必须携带记录数据来源（recordDataSource）')
  }

  const link = /** @type {GeneralizationIssueLink} */ ({
    id: randomId(),
    issueId,
    recordId,
    recordDataSource: isGeneralizationRecordDataSource(input?.recordDataSource)
      ? input.recordDataSource
      : '',
    ticketId: String(input?.ticketId ?? '').trim(),
    linkStatus,
    linkSource,
    matchConfidence: GENERALIZATION_MATCH_CONFIDENCES.includes(
      /** @type {'high' | 'medium' | 'low'} */ (input?.matchConfidence),
    )
      ? /** @type {GeneralizationMatchConfidence} */ (input?.matchConfidence)
      : '',
    matchReason: String(input?.matchReason ?? '').trim(),
    matchedExcerpt: String(input?.matchedExcerpt ?? '').trim(),
    proposedAt: String(input?.proposedAt ?? '').trim(),
    reviewedBy: String(input?.reviewedBy ?? '').trim(),
    reviewedAt: String(input?.reviewedAt ?? '').trim(),
    createdAt: new Date().toISOString(),
  })
  return { link, errors }
}
