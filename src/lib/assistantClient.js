/**
 * AI 助手前端 API 客户端。
 */
import { apiFetch } from './apiClient.js'

/**
 * @typedef {Object} AssistantThread
 * @property {string} id
 * @property {string} title
 * @property {string} updatedAt
 * @property {string} createdAt
 */

/**
 * @typedef {Object} AssistantCitation
 * @property {string} recordId
 * @property {string} [ticketId]
 * @property {string} [dataSourceType]
 * @property {string} [field]
 * @property {string} [snippet]
 */

/**
 * @typedef {Object} AssistantLink
 * @property {'workbench' | 'analysis' | 'feedbacks' | 'actions'} kind
 * @property {Record<string, string>} params
 */

/**
 * @typedef {Object} AssistantMessage
 * @property {string} id
 * @property {'user' | 'assistant'} role
 * @property {Record<string, unknown>} payload
 * @property {string} createdAt
 */

/**
 * @returns {Promise<{ threads: AssistantThread[] }>}
 */
export async function listAssistantThreads() {
  return apiFetch('/api/assistant/threads')
}

/**
 * @param {{ title?: string }} [options]
 * @returns {Promise<{ thread: AssistantThread }>}
 */
export async function createAssistantThread(options = {}) {
  return apiFetch('/api/assistant/threads', {
    method: 'POST',
    body: JSON.stringify({ title: options.title || '新对话' }),
  })
}

/**
 * @param {string} threadId
 * @returns {Promise<{ messages: AssistantMessage[] }>}
 */
export async function listAssistantMessages(threadId) {
  return apiFetch(`/api/assistant/threads/${encodeURIComponent(threadId)}/messages`)
}

/**
 * @param {string} threadId
 * @returns {Promise<{ ok: boolean }>}
 */
export async function deleteAssistantThread(threadId) {
  return apiFetch(`/api/assistant/threads/${encodeURIComponent(threadId)}`, {
    method: 'DELETE',
  })
}

/**
 * @param {{
 *   threadId: string
 *   question: string
 *   insightPeriodId?: string
 *   pageContext?: { pathname?: string; query?: Record<string, string> }
 * }} params
 * @returns {Promise<{ message: AssistantMessage }>}
 */
export async function sendAssistantChat(params) {
  return apiFetch('/api/assistant/chat', {
    method: 'POST',
    body: JSON.stringify({
      threadId: params.threadId,
      question: params.question,
      insightPeriodId: params.insightPeriodId || '',
      pageContext: params.pageContext || undefined,
    }),
  })
}
