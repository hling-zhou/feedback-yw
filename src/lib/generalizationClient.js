import { apiFetch } from './apiClient.js'

/**
 * 举一反三 API client —— 与 server/routes/generalization.js 一一对应。
 * @see docs/DESIGN-20261102-1.md §4.1
 */

/** @typedef {import('../domain/generalizationIssue.js').GeneralizationIssue} GeneralizationIssue */
/** @typedef {import('../domain/generalizationIssue.js').GeneralizationIssueLink} GeneralizationIssueLink */
/** @typedef {import('../domain/generalizationIssue.js').GeneralizationCategory} GeneralizationCategory */
/** @typedef {import('../domain/generalizationIssue.js').GeneralizationScope} GeneralizationScope */

/**
 * @typedef {Object} GeneralizationIssueListQuery
 * @property {number} [page]
 * @property {number} [pageSize]
 * @property {string} [productKey]
 * @property {'in_progress' | 'completed' | 'terminated'} [status]
 * @property {GeneralizationCategory} [category]
 * @property {GeneralizationScope} [scope]
 * @property {string} [keyword]
 * @property {string} [actionItemId] - 反查：该举措升级出的举一反三问题
 */

/**
 * @typedef {Object} GeneralizationIssueListResult
 * @property {number} total
 * @property {number} page
 * @property {number} pageSize
 * @property {(GeneralizationIssue & { ticketCount: number, ratingCount: number })[]} issues
 */

/**
 * @typedef {Object} GeneralizationIssueCreateInput
 * @property {string} productKey
 * @property {string} productName
 * @property {string} title
 * @property {string} summary
 * @property {GeneralizationCategory} category
 * @property {GeneralizationScope} scope
 * @property {string} [rootCause] - 创建可空（Tab 补全）
 * @property {string} [optimization] - 创建可空（Tab 补全；升级预填←举措内容）
 * @property {string[]} [keywords]
 * @property {string} [notes]
 * @property {{ recordId: string, recordDataSource: 'complaint_ticket' | 'consultation_ticket' | 'post_use_rating', ticketId?: string }} [firstLink]
 */

/**
 * @typedef {Object} GeneralizationLinkAttachInput
 * @property {string} recordId
 * @property {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} recordDataSource
 * @property {string} [ticketId]
 * @property {boolean} [overrideDismissed]
 */

/**
 * @typedef {Object} GeneralizationMatchRecordStub
 * @property {string} ticketId
 * @property {string} product
 * @property {string} painPoint
 * @property {string} customerRequest
 * @property {string} dataSourceType
 * @property {string} createdAt
 */

/**
 * @typedef {Object} GeneralizationPendingSuggestion
 * @property {GeneralizationIssueLink} link 字段平铺（见路由返回——本 typedef 同时列出常用平铺字段）
 * @property {string} id
 * @property {string} issueId
 * @property {string} recordId
 * @property {string} recordDataSource
 * @property {string} ticketId
 * @property {'confirmed' | 'pending_suggest' | 'dismissed'} [linkStatus]
 * @property {string} matchReason
 * @property {string} matchedExcerpt
 * @property {'high' | 'medium' | 'low'} [matchConfidence]
 * @property {string} proposedAt
 * @property {string} createdAt
 * @property {string} issueTitle
 * @property {string} productName
 * @property {GeneralizationMatchRecordStub | null} record
 */

/**
 * @typedef {Object} GeneralizationHint
 * @property {string} [suggested]
 * @property {string} [category]
 * @property {string} [scope]
 * @property {string} [confidence]
 * @property {string} [reason]
 * @property {string} [suggestedAt]
 * @property {'pending' | 'adopted' | 'dismissed'} [status]
 * @property {string} [adoptedToIssueId]
 * @property {string} [decidedAt]
 * @property {string} [decidedBy]
 * @property {string} [promptVersion]
 */

/**
 * @typedef {Object} GeneralizationActionRef
 * @property {string} actionItemId
 * @property {'created' | 'linked'} kind
 * @property {string} createdAt
 * @property {boolean} actionExists - 举措删除后 false（前端降级"来源举措已删除"）
 * @property {string} actionTitle
 * @property {string} actionStatus
 * @property {string} actionProductName
 */

/**
 * @param {GeneralizationIssueListQuery} [query]
 * @returns {Promise<GeneralizationIssueListResult>}
 */
export async function listGeneralizationIssues(query = {}) {
  const params = new URLSearchParams()
  if (query.page != null) params.set('page', String(query.page))
  if (query.pageSize != null) params.set('pageSize', String(query.pageSize))
  if (query.productKey) params.set('productKey', query.productKey)
  if (query.status) params.set('status', query.status)
  if (query.category) params.set('category', query.category)
  if (query.scope) params.set('scope', query.scope)
  if (query.keyword) params.set('keyword', query.keyword)
  if (query.actionItemId) params.set('actionItemId', query.actionItemId)
  const qs = params.toString()
  return apiFetch(`/api/generalization/issues${qs ? `?${qs}` : ''}`)
}

/**
 * @param {string} id
 * @returns {Promise<{ issue: GeneralizationIssue, links: GeneralizationIssueLink[], actionRefs: GeneralizationActionRef[] }>}
 */
export async function getGeneralizationIssue(id) {
  return apiFetch(`/api/generalization/issues/${encodeURIComponent(id)}`)
}

/**
 * 新建（响应含 similarHints 去重提示——轻提示不强制）。
 * @param {GeneralizationIssueCreateInput} input
 * @returns {Promise<{ issue: GeneralizationIssue, similarHints: Array<{ issueId: string, title: string, summary: string, productName: string, category: string, scope: string }> }>}
 */
export async function createGeneralizationIssue(input) {
  return apiFetch('/api/generalization/issues', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 编辑（Tab 侧滑唯一编辑入口：rootCause/optimization 出现即必填非空）。
 * @param {string} id
 * @param {{ title?: string, summary?: string, category?: GeneralizationCategory, scope?: GeneralizationScope, rootCause?: string, optimization?: string, status?: 'in_progress' | 'completed' | 'terminated', keywords?: string[], notes?: string }} patch
 * @returns {Promise<{ issue: GeneralizationIssue }>}
 */
export async function updateGeneralizationIssue(id, patch) {
  return apiFetch(`/api/generalization/issues/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * @param {string} id
 * @returns {Promise<{ ok: boolean, linksDeleted: number, actionRefsDeleted: number }>}
 */
export async function deleteGeneralizationIssue(id) {
  return apiFetch(`/api/generalization/issues/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/**
 * 人工挂证据（S1 兜底 / 首条关联 / S3 推翻 dismissed）。
 * @param {string} issueId
 * @param {GeneralizationLinkAttachInput} input
 * @returns {Promise<{ link: GeneralizationIssueLink }>}
 */
export async function attachGeneralizationLink(issueId, input) {
  return apiFetch(`/api/generalization/issues/${encodeURIComponent(issueId)}/links`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 解除关联。
 * @param {string} issueId
 * @param {string} linkId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function detachGeneralizationLink(issueId, linkId) {
  return apiFetch(
    `/api/generalization/issues/${encodeURIComponent(issueId)}/links/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' },
  )
}

/**
 * 按记录取关联+建议（抽屉卡数据源）。
 * @param {string} recordId
 * @returns {Promise<GeneralizationIssueLink[]>}
 */
export async function listGeneralizationLinksByRecord(recordId) {
  const { links } = await apiFetch(
    `/api/generalization/records/${encodeURIComponent(recordId)}/links`,
  )
  return links
}

/**
 * 按记录取 AI 建议（抽屉建议条数据源）。
 * @param {string} recordId
 * @returns {Promise<GeneralizationHint | null>}
 */
export async function getGeneralizationHint(recordId) {
  const { hint } = await apiFetch(
    `/api/generalization/records/${encodeURIComponent(recordId)}/hint`,
  )
  return hint ?? null
}

/**
 * 采纳 AI 建议：新建 issue（预填 category/scope）+ 首条 confirmed link = 宿主记录。
 * @param {string} recordId
 * @returns {Promise<{ hint: GeneralizationHint, issue: GeneralizationIssue }>}
 */
export async function adoptGeneralizationHint(recordId) {
  return apiFetch(`/api/generalization/hints/${encodeURIComponent(recordId)}/adopt`, {
    method: 'POST',
  })
}

/**
 * 忽略 AI 建议（pending → dismissed，不再重弹）。
 * @param {string} recordId
 * @returns {Promise<{ hint: GeneralizationHint }>}
 */
export async function dismissGeneralizationHint(recordId) {
  return apiFetch(`/api/generalization/hints/${encodeURIComponent(recordId)}/dismiss`, {
    method: 'POST',
  })
}

/**
 * 待复核建议队列。
 * @param {{ page?: number, pageSize?: number, confidence?: 'high' | 'medium' | 'low' }} [query]
 * @returns {Promise<{ total: number, page: number, pageSize: number, suggestions: GeneralizationPendingSuggestion[] }>}
 */
export async function listGeneralizationPendingMatches(query = {}) {
  const params = new URLSearchParams()
  if (query.page != null) params.set('page', String(query.page))
  if (query.pageSize != null) params.set('pageSize', String(query.pageSize))
  if (query.confidence) params.set('confidence', query.confidence)
  const qs = params.toString()
  return apiFetch(`/api/generalization/matches${qs ? `?${qs}` : ''}`)
}

/**
 * @returns {Promise<{ total: number, high: number, medium: number, low: number }>}
 */
export async function getGeneralizationPendingCount() {
  return apiFetch('/api/generalization/matches/pending-count')
}

/**
 * 三选一复核。
 * @param {string} linkId
 * @param {'confirm' | 'dismiss' | 'new_issue'} action
 * @param {{ newIssue?: { title: string, summary: string, productKey: string, productName: string, category: GeneralizationCategory, scope: GeneralizationScope, keywords?: string[], notes?: string } }} [payload]
 * @returns {Promise<{ action: string, link?: GeneralizationIssueLink, issue?: GeneralizationIssue }>}
 */
export async function reviewGeneralizationMatch(linkId, action, payload = {}) {
  return apiFetch(`/api/generalization/matches/${encodeURIComponent(linkId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  })
}

/**
 * 人工兜底搜可挂记录（只搜投诉/咨询——证据域）。
 * @param {{ query: string, productKey?: string, limit?: number }} params
 * @returns {Promise<{ records: Array<{ recordId: string, ticketId: string, productKey: string, productName: string, dataSourceType: string, summary: string, createdAt: string, sameProduct: boolean, alreadyLinkedElsewhere: boolean }> }>}
 */
export async function searchGeneralizationRecords(params) {
  const qs = new URLSearchParams({ query: params.query })
  if (params.productKey) qs.set('productKey', params.productKey)
  if (params.limit != null) qs.set('limit', String(params.limit))
  return apiFetch(`/api/generalization/records/search?${qs.toString()}`)
}

/**
 * 举措升级（from-action 双模式）。
 * mode=create：新建 gen issue（产品/证据从举措带入；仅 optimization 预填，root_cause 不预填）。
 * mode=link：关联已有 in_progress issue。
 * @param {{ actionItemId: string, mode: 'create', title: string, summary: string, category: GeneralizationCategory, scope: GeneralizationScope, optimization?: string, keywords?: string[], notes?: string } | { actionItemId: string, mode: 'link', issueId: string }} input
 * @returns {Promise<{ issue: GeneralizationIssue, evidenceLinked: number, evidenceSkipped: number }>}
 */
export async function upgradeActionToGeneralization(input) {
  return apiFetch('/api/generalization/from-action', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * 举措已关联的举一反三问题（升级入口"已升级态"反查——走 listIssues actionItemId 筛选）。
 * @param {string} actionItemId
 * @returns {Promise<GeneralizationIssueListResult>}
 */
export async function listGeneralizationIssuesForAction(actionItemId) {
  return listGeneralizationIssues({ actionItemId, pageSize: 20 })
}

/**
 * 手动补跑扫描（G2 引擎落地后生效；G0 期间后端返回 501）。
 * @param {{ importMonth?: string, recordIds?: string[], generalizationOnly?: boolean, gPassRetry?: boolean }} [payload]
 */
export async function triggerGeneralizationScan(payload = {}) {
  return apiFetch('/api/generalization/scan', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
