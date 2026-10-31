/**
 * 留观问题（Observation Issue）领域模型 —— 枚举、构建器与校验。
 * @see docs/DESIGN-20261031-1.md §2 数据模型、§3.2 判定依据
 */

import { randomId } from '../lib/randomId.js'

/** @typedef {'watching' | 'promoted' | 'archived'} ObservationIssueStatus */

/** @typedef {'confirmed' | 'pending_suggest' | 'dismissed'} ObservationLinkStatus */

/** @typedef {'manual' | 'auto_match' | 'auto_anchor'} ObservationLinkSource */

/** @typedef {'' | 'high' | 'medium' | 'low'} ObservationMatchConfidence */

/** @typedef {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} ObservationRecordDataSource */

/**
 * @typedef {Object} ObservationIssue
 * @property {string} id
 * @property {string} productKey
 * @property {string} productName
 * @property {ObservationIssueStatus} status
 * @property {string} title
 * @property {string} summary - 问题描述（≤100 字，人工主锚点）
 * @property {number} occurrenceCount - 冗余计数；links(confirmed) 为真源
 * @property {string} firstSeenAt
 * @property {string} lastSeenAt
 * @property {{ keywords?: string[], notes?: string, promotedTo?: { actionItemId?: string, promotedAt?: string, promotedBy?: string } }} [payload]
 * @property {string} createdBy
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ObservationIssueLink
 * @property {string} id
 * @property {string} issueId
 * @property {string} recordId
 * @property {ObservationRecordDataSource} recordDataSource
 * @property {string} ticketId
 * @property {ObservationLinkStatus} linkStatus
 * @property {ObservationLinkSource} linkSource
 * @property {ObservationMatchConfidence} matchConfidence
 * @property {string} matchReason
 * @property {string} matchedExcerpt
 * @property {string} proposedAt
 * @property {string} reviewedBy
 * @property {string} reviewedAt
 * @property {string} createdAt
 */

/** @type {ObservationIssueStatus[]} */
export const OBSERVATION_ISSUE_STATUSES = ['watching', 'promoted', 'archived']

/** @type {Record<ObservationIssueStatus, string>} */
export const OBSERVATION_ISSUE_STATUS_LABELS = {
  watching: '观察中',
  promoted: '已升级',
  archived: '已关闭',
}

/** @type {ObservationLinkStatus[]} */
export const OBSERVATION_LINK_STATUSES = ['confirmed', 'pending_suggest', 'dismissed']

/** @type {Record<ObservationLinkStatus, string>} */
export const OBSERVATION_LINK_STATUS_LABELS = {
  confirmed: '已确认',
  pending_suggest: '待复核',
  dismissed: '已否决',
}

/** @type {ObservationLinkSource[]} */
export const OBSERVATION_LINK_SOURCES = ['manual', 'auto_match', 'auto_anchor']

/** @type {Record<ObservationLinkSource, string>} */
export const OBSERVATION_LINK_SOURCE_LABELS = {
  manual: '人工',
  auto_match: '自动判别',
  auto_anchor: '锚点',
}

/** @type {Array<'high' | 'medium' | 'low'>} */
export const OBSERVATION_MATCH_CONFIDENCES = ['high', 'medium', 'low']

/** @type {Record<'high' | 'medium' | 'low', string>} */
export const OBSERVATION_MATCH_CONFIDENCE_LABELS = {
  high: '高',
  medium: '中',
  low: '低',
}

/** 问题描述上限（设计定稿：100 字） */
export const OBSERVATION_SUMMARY_MAX_LENGTH = 100

/** 依据标签 dedupe 键（UNIQUE(issue_id, record_id) 的应用层镜像，供校验提示） */
export const OBSERVATION_LINK_DEDUPE_HINT = '同一条记录与同一留观问题只能有一条关联'

/**
 * @param {unknown} value
 * @returns {value is ObservationIssueStatus}
 */
export function isObservationIssueStatus(value) {
  return OBSERVATION_ISSUE_STATUSES.includes(/** @type {ObservationIssueStatus} */ (value))
}

/**
 * @param {unknown} value
 * @returns {value is ObservationLinkStatus}
 */
export function isObservationLinkStatus(value) {
  return OBSERVATION_LINK_STATUSES.includes(/** @type {ObservationLinkStatus} */ (value))
}

/**
 * @param {unknown} value
 * @returns {value is ObservationRecordDataSource}
 */
export function isObservationRecordDataSource(value) {
  return (
    value === 'complaint_ticket' ||
    value === 'consultation_ticket' ||
    value === 'post_use_rating'
  )
}

/**
 * 归一化留观 payload：keywords 去空去重、notes/promotedTo 透传。
 * @param {unknown} value
 * @returns {ObservationIssue['payload']}
 */
export function normalizeObservationPayload(value) {
  if (!value || typeof value !== 'object') return {}
  const raw = /** @type {Record<string, unknown>} */ (value)
  const out = /** @type {ObservationIssue['payload']} */ ({})
  if (Array.isArray(raw.keywords)) {
    out.keywords = raw.keywords
      .map((k) => String(k ?? '').trim())
      .filter(Boolean)
      .slice(0, 20)
  }
  if (typeof raw.notes === 'string' && raw.notes.trim()) out.notes = raw.notes.trim()
  if (raw.promotedTo && typeof raw.promotedTo === 'object') {
    const p = /** @type {Record<string, unknown>} */ (raw.promotedTo)
    out.promotedTo = {
      actionItemId: String(p.actionItemId ?? '').trim(),
      promotedAt: String(p.promotedAt ?? '').trim(),
      promotedBy: String(p.promotedBy ?? '').trim(),
    }
  }
  return out
}

/**
 * 构建新留观问题（服务端/前端共用；id/createdAt 由调用方或此处补齐）。
 *
 * @param {{
 *   productKey?: string
 *   productName?: string
 *   title?: string
 *   summary?: string
 *   keywords?: string[]
 *   notes?: string
 *   createdBy?: string
 * }} input
 * @returns {{ issue: ObservationIssue, errors: string[] }}
 */
export function buildObservationIssueFromInput(input) {
  const errors = []
  const title = String(input?.title ?? '').trim()
  const summary = String(input?.summary ?? '').trim()
  const productName = String(input?.productName ?? '').trim()
  const productKey = String(input?.productKey ?? '').trim()
  if (!title) errors.push('问题标题不能为空')
  if (title.length > OBSERVATION_SUMMARY_MAX_LENGTH) {
    errors.push(`标题不能超过 ${OBSERVATION_SUMMARY_MAX_LENGTH} 字`)
  }
  if (!summary) errors.push('问题描述不能为空')
  if (summary.length > OBSERVATION_SUMMARY_MAX_LENGTH) {
    errors.push(`问题描述不能超过 ${OBSERVATION_SUMMARY_MAX_LENGTH} 字`)
  }
  if (!productName || !productKey) errors.push('产品不能为空')
  const issue = /** @type {ObservationIssue} */ ({
    id: randomId(),
    productKey,
    productName,
    status: 'watching',
    title,
    summary,
    occurrenceCount: 0,
    firstSeenAt: '',
    lastSeenAt: '',
    payload: normalizeObservationPayload({ keywords: input?.keywords, notes: input?.notes }),
    createdBy: String(input?.createdBy ?? '').trim(),
    createdAt: new Date().toISOString(),
  })
  return { issue, errors }
}

/**
 * 构建关联证据 link。
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
 * @returns {{ link: ObservationIssueLink, errors: string[] }}
 */
export function buildObservationLinkFromInput(input) {
  const errors = []
  const issueId = String(input?.issueId ?? '').trim()
  const recordId = String(input?.recordId ?? '').trim()
  if (!issueId) errors.push('issueId 不能为空')
  if (!recordId) errors.push('recordId 不能为空')

  const linkStatus = isObservationLinkStatus(input?.linkStatus) ? input.linkStatus : 'confirmed'
  const linkSource = OBSERVATION_LINK_SOURCES.includes(
    /** @type {ObservationLinkSource} */ (input?.linkSource),
  )
    ? /** @type {ObservationLinkSource} */ (input?.linkSource)
    : 'manual'

  if (linkStatus === 'pending_suggest' && !isObservationRecordDataSource(input?.recordDataSource)) {
    errors.push('自动建议必须携带记录数据来源（recordDataSource）')
  }

  const link = /** @type {ObservationIssueLink} */ ({
    id: randomId(),
    issueId,
    recordId,
    recordDataSource: isObservationRecordDataSource(input?.recordDataSource)
      ? input.recordDataSource
      : '',
    ticketId: String(input?.ticketId ?? '').trim(),
    linkStatus,
    linkSource,
    matchConfidence: OBSERVATION_MATCH_CONFIDENCES.includes(
      /** @type {'high' | 'medium' | 'low'} */ (input?.matchConfidence),
    )
      ? /** @type {ObservationMatchConfidence} */ (input?.matchConfidence)
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
