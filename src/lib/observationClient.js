import { apiFetch } from './apiClient.js'

/**
 * 留观问题 API client —— 与 server/routes/observation.js 一一对应。
 * @see docs/DESIGN-20261031-1.md §4.2
 */

/** @typedef {import('../domain/observationIssue.js').ObservationIssue} ObservationIssue */
/** @typedef {import('../domain/observationIssue.js').ObservationIssueLink} ObservationIssueLink */

/**
 * @typedef {Object} ObservationIssueListQuery
 * @property {number} [page]
 * @property {number} [pageSize]
 * @property {string} [productKey]
 * @property {'watching' | 'promoted' | 'archived'} [status]
 * @property {'all' | 'has_ticket' | 'rating_only'} [sourceMix]
 * @property {string} [keyword]
 */

/**
 * @typedef {Object} ObservationIssueListResult
 * @property {number} total
 * @property {number} page
 * @property {number} pageSize
 * @property {(ObservationIssue & { ticketCount: number, ratingCount: number })[]} issues
 */

/**
 * @typedef {Object} ObservationIssueCreateInput
 * @property {string} productKey
 * @property {string} productName
 * @property {string} title
 * @property {string} summary
 * @property {string[]} [keywords]
 * @property {string} [notes]
 * @property {{ recordId: string, recordDataSource: 'complaint_ticket' | 'consultation_ticket' | 'post_use_rating', ticketId?: string }} [firstLink]
 */

/**
 * @typedef {Object} ObservationLinkAttachInput
 * @property {string} recordId
 * @property {'complaint_ticket' | 'consultation_ticket' | 'post_use_rating'} recordDataSource
 * @property {string} [ticketId]
 * @property {boolean} [overrideDismissed]
 */

/**
 * @typedef {Object} ObservationMatchRecordStub
 * @property {string} ticketId
 * @property {string} product
 * @property {string} painPoint
 * @property {string} customerRequest
 * @property {string} dataSourceType
 * @property {string} createdAt
 */

/**
 * @typedef {Object} ObservationPendingSuggestion
 * @property {ObservationIssueLink} link 字段平铺（见路由返回）
 * @property {string} issueTitle
 * @property {string} productName
 * @property {ObservationMatchRecordStub | null} record
 */

/**
 * @param {ObservationIssueListQuery} [query]
 * @returns {Promise<ObservationIssueListResult>}
 */
export async function listObservationIssues(query = {}) {
  const params = new URLSearchParams()
  if (query.page != null) params.set('page', String(query.page))
  if (query.pageSize != null) params.set('pageSize', String(query.pageSize))
  if (query.productKey) params.set('productKey', query.productKey)
  if (query.status) params.set('status', query.status)
  if (query.sourceMix) params.set('sourceMix', query.sourceMix)
  if (query.keyword) params.set('keyword', query.keyword)
  const qs = params.toString()
  return apiFetch(`/api/observation/issues${qs ? `?${qs}` : ''}`)
}

/**
 * @param {string} id
 * @returns {Promise<{ issue: ObservationIssue, links: ObservationIssueLink[] }>}
 */
export async function getObservationIssue(id) {
  return apiFetch(`/api/observation/issues/${encodeURIComponent(id)}`)
}

/**
 * @param {ObservationIssueCreateInput} input
 * @returns {Promise<{ issue: ObservationIssue }>}
 */
export async function createObservationIssue(input) {
  return apiFetch('/api/observation/issues', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

/**
 * @param {string} id
 * @param {{ title?: string, summary?: string, status?: 'watching' | 'promoted' | 'archived', keywords?: string[], notes?: string }} patch
 * @returns {Promise<{ issue: ObservationIssue }>}
 */
export async function updateObservationIssue(id, patch) {
  return apiFetch(`/api/observation/issues/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  })
}

/**
 * @param {string} id
 * @returns {Promise<{ ok: boolean, linksDeleted: number }>}
 */
export async function deleteObservationIssue(id) {
  return apiFetch(`/api/observation/issues/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  })
}

/**
 * 人工挂证据（S1 兜底 / 首条关联）。
 * @param {string} issueId
 * @param {ObservationLinkAttachInput} input
 * @returns {Promise<{ link: ObservationIssueLink }>}
 */
export async function attachObservationLink(issueId, input) {
  return apiFetch(`/api/observation/issues/${encodeURIComponent(issueId)}/links`, {
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
export async function detachObservationLink(issueId, linkId) {
  return apiFetch(
    `/api/observation/issues/${encodeURIComponent(issueId)}/links/${encodeURIComponent(linkId)}`,
    { method: 'DELETE' },
  )
}

/**
 * 按记录取关联+建议（抽屉卡数据源）。
 * @param {string} recordId
 * @returns {Promise<ObservationIssueLink[]>}
 */
export async function listObservationLinksByRecord(recordId) {
  const { links } = await apiFetch(
    `/api/observation/records/${encodeURIComponent(recordId)}/links`,
  )
  return links
}

/**
 * 待复核建议队列。
 * @param {{ page?: number, pageSize?: number, confidence?: 'high' | 'medium' | 'low' }} [query]
 * @returns {Promise<{ total: number, page: number, pageSize: number, suggestions: ObservationPendingSuggestion[] }>}
 */
export async function listObservationPendingMatches(query = {}) {
  const params = new URLSearchParams()
  if (query.page != null) params.set('page', String(query.page))
  if (query.pageSize != null) params.set('pageSize', String(query.pageSize))
  if (query.confidence) params.set('confidence', query.confidence)
  const qs = params.toString()
  return apiFetch(`/api/observation/matches${qs ? `?${qs}` : ''}`)
}

/**
 * @returns {Promise<{ total: number, high: number, medium: number, low: number }>}
 */
export async function getObservationPendingCount() {
  return apiFetch('/api/observation/matches/pending-count')
}

/**
 * 三选一复核。
 * @param {string} linkId
 * @param {'confirm' | 'dismiss' | 'new_issue'} action
 * @param {{ newIssue?: { title: string, summary: string, productKey: string, productName: string, keywords?: string[], notes?: string } }} [payload]
 * @returns {Promise<{ action: string, link?: ObservationIssueLink, issue?: ObservationIssue }>}
 */
export async function reviewObservationMatch(linkId, action, payload = {}) {
  return apiFetch(`/api/observation/matches/${encodeURIComponent(linkId)}/review`, {
    method: 'POST',
    body: JSON.stringify({ action, ...payload }),
  })
}

/**
 * 人工兜底搜可挂记录。
 * @param {{ query: string, productKey?: string, limit?: number }} params
 * @returns {Promise<{ records: Array<{ recordId: string, ticketId: string, productKey: string, productName: string, dataSourceType: string, summary: string, createdAt: string, sameProduct: boolean, alreadyLinkedElsewhere: boolean }> }>}
 */
export async function searchObservationRecords(params) {
  const qs = new URLSearchParams({ query: params.query })
  if (params.productKey) qs.set('productKey', params.productKey)
  if (params.limit != null) qs.set('limit', String(params.limit))
  return apiFetch(`/api/observation/records/search?${qs.toString()}`)
}

/**
 * 升级为正式举措（F2）：预填建 action_items(source=observation) + issue 转 promoted。
 * @param {string} issueId
 * @returns {Promise<{ ok: boolean, actionItemId: string }>}
 */
export async function promoteObservationIssue(issueId) {
  return apiFetch(`/api/observation/issues/${encodeURIComponent(issueId)}/promote`, {
    method: 'POST',
  })
}

/**
 * 手动触发批量识别（O2 引擎落地后生效）。
 * @param {{ importMonth?: string, recordIds?: string[] }} [payload]
 */
export async function triggerObservationScan(payload = {}) {
  return apiFetch('/api/observation/scan', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}
