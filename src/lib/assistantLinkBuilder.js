/**
 * AI 助手跳转链接构造器。
 *
 * 模型只返回 { kind, params }；服务端校验枚举后原样返回，前端用现成函数生成地址。
 * 用后即评必须带 source=post_use_rating。工单号超过 20 个时写入当前浏览器 sessionStorage。
 */
import { buildWorkbenchAnalysisUrl } from './workbenchAnalysisLink.js'
import { buildFeedbacksUrl } from './feedbackFilters.js'
import { writeFeedbackTicketIdSet } from './feedbackTicketIdSet.js'

const FEEDBACK_TICKET_URL_LIMIT = 20

const WORKBENCH_TABS = new Set([
  'overview',
  'complaint_ticket',
  'consultation_ticket',
  'post_use_rating',
])

const ACTIONS_TABS = new Set([
  'ticket-todos',
  'product',
  'post-use-jira',
  'problem-reduction',
  'playbook',
])

/**
 * @typedef {Object} AssistantLink
 * @property {'workbench' | 'analysis' | 'feedbacks' | 'actions'} kind
 * @property {Record<string, string>} params
 */

/**
 * 把助手 link 转成站内 URL。非法 kind/tab 返回 null。
 * @param {AssistantLink} link
 * @returns {string | null}
 */
export function buildAssistantLinkHref(link) {
  if (!link || typeof link !== 'object') return null
  const { kind, params } = link
  const p = params || {}

  if (kind === 'workbench') {
    const tab = String(p.tab || 'overview')
    if (!WORKBENCH_TABS.has(tab)) return null
    return `/workbench?tab=${encodeURIComponent(tab)}`
  }

  if (kind === 'analysis') {
    return buildWorkbenchAnalysisUrl({
      source: p.source,
      product: p.product,
      journeyL1: p.journeyL1,
      journeyL2: p.journeyL2,
      problemType: p.problemType,
      complaintCauseL1: p.complaintCauseL1,
      requestScene: p.requestScene,
      tab: p.tab,
    })
  }

  if (kind === 'actions') {
    const tab = String(p.tab || 'ticket-todos')
    if (!ACTIONS_TABS.has(tab)) return null
    return `/actions?tab=${encodeURIComponent(tab)}`
  }

  if (kind === 'feedbacks') {
    /** @type {Record<string, string>} */
    const urlParams = {}
    if (p.source) urlParams.source = p.source
    if (p.product) urlParams.product = p.product
    if (p.month) urlParams.month = p.month

    // 工单号列表
    const ticketIds = parseTicketIds(p.ticketIds)
    if (ticketIds.length === 1) {
      urlParams.ticketIds = ticketIds[0]
    } else if (ticketIds.length > 1 && ticketIds.length <= FEEDBACK_TICKET_URL_LIMIT) {
      urlParams.ticketIds = ticketIds.join(',')
    } else if (ticketIds.length > FEEDBACK_TICKET_URL_LIMIT) {
      const setId = writeFeedbackTicketIdSet(ticketIds, { label: 'AI 助手检索结果' })
      if (setId) urlParams.ticketIdSet = setId
    }
    return buildFeedbacksUrl(urlParams)
  }

  return null
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function parseTicketIds(value) {
  if (!value) return []
  if (Array.isArray(value)) {
    return value.map((v) => String(v || '').trim()).filter(Boolean)
  }
  return String(value)
    .split(',')
    .map((v) => v.trim())
    .filter(Boolean)
}

/**
 * 单条引用点击后打开反馈库并筛到该条。
 * @param {{ ticketId?: string; dataSourceType?: string }} citation
 * @returns {string | null}
 */
export function buildAssistantCitationHref(citation) {
  if (!citation || !citation.ticketId) return null
  return buildFeedbacksUrl({
    ticketId: String(citation.ticketId),
    source: citation.dataSourceType || undefined,
  })
}
