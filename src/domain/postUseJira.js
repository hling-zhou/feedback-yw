export const POST_USE_JIRA_STATUSES = /** @type {const} */ (['待处理', '进行中', '已完成'])

/** @typedef {(typeof POST_USE_JIRA_STATUSES)[number]} PostUseJiraStatus */

export const POST_USE_JIRA_DEFAULT_STATUS = /** @type {PostUseJiraStatus} */ ('待处理')

export const POST_USE_JIRA_EDITABLE_FIELDS = /** @type {const} */ (['jiraTicket', 'status', 'progress'])

/**
 * @param {unknown} value
 * @returns {value is PostUseJiraStatus}
 */
export function isPostUseJiraStatus(value) {
  return POST_USE_JIRA_STATUSES.includes(/** @type {PostUseJiraStatus} */ (value))
}

/**
 * @param {unknown} value
 */
export function normalizePostUseJiraStatus(value) {
  const text = String(value || '').trim()
  return isPostUseJiraStatus(text) ? text : POST_USE_JIRA_DEFAULT_STATUS
}

/**
 * @param {Record<string, unknown>} patch
 */
export function pickPostUseJiraEditablePatch(patch) {
  /** @type {Record<string, string>} */
  const next = {}
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'jiraTicket')) {
    next.jiraTicket = String(patch.jiraTicket ?? '').trim()
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'status')) {
    next.status = normalizePostUseJiraStatus(patch.status)
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'progress')) {
    next.progress = String(patch.progress ?? '').trim()
  }
  return next
}
