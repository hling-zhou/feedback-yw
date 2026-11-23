import { apiFetch } from '../apiClient.js'

export async function listReportIssueLinks() {
  const response = await apiFetch('/api/post-use-report/links')
  return response?.items || []
}

export async function listSourceReportIssues(sourceType, sourceId) {
  const params = new URLSearchParams({ sourceType, sourceId })
  return apiFetch(`/api/post-use-report/source-issues?${params}`)
}

export function saveReportIssueLink(sourceType, sourceId, issueId, verdict) {
  return apiFetch('/api/post-use-report/links', {
    method: 'PUT', body: JSON.stringify({ sourceType, sourceId, issueId, verdict }),
  })
}

export function deleteReportIssueLink(sourceType, sourceId, issueId) {
  return apiFetch('/api/post-use-report/links', {
    method: 'DELETE', body: JSON.stringify({ sourceType, sourceId, issueId }),
  })
}

/**
 * 11-23 拍板：LLM 语义自动判定候选问题关联（服务端跑，verdictSource='llm'；uncertain 不写留人工）。
 */
export function autoJudgeReportIssueLinks(sourceType, sourceId) {
  return apiFetch('/api/post-use-report/links/auto', {
    method: 'POST', body: JSON.stringify({ sourceType, sourceId }),
  })
}

export async function listReportDrafts(reportKey) {
  const response = await apiFetch(`/api/post-use-report/drafts?reportKey=${encodeURIComponent(reportKey)}`)
  return response?.items || []
}

export function saveReportDraft(reportKey, productName, fingerprint, draft) {
  return apiFetch('/api/post-use-report/drafts', {
    method: 'PUT', body: JSON.stringify({ reportKey, productName, fingerprint, ...draft }),
  })
}
