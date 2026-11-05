export const POST_USE_JIRA_STATUSES = /** @type {const} */ (['待处理', '处理中', '已处理'])

/** @typedef {(typeof POST_USE_JIRA_STATUSES)[number]} PostUseJiraStatus */

export const POST_USE_JIRA_DEFAULT_STATUS = /** @type {PostUseJiraStatus} */ ('待处理')

/** 2026-11-05 处理状态自动流转前的旧枚举值 → 新值（已处理=完成态；读取归一，无存量迁移） */
const POST_USE_JIRA_STATUS_ALIASES = /** @type {Record<string, PostUseJiraStatus>} */ ({
  进行中: '处理中',
  已完成: '已处理',
})

export const POST_USE_JIRA_EDITABLE_FIELDS = /** @type {const} */ (['jiraTicket', 'status', 'progress', 'assigneeId', 'assigneeName'])

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
  if (isPostUseJiraStatus(text)) return text
  return POST_USE_JIRA_STATUS_ALIASES[text] || POST_USE_JIRA_DEFAULT_STATUS
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
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'assigneeId')) {
    next.assigneeId = String(patch.assigneeId ?? '').trim()
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'assigneeName')) {
    next.assigneeName = String(patch.assigneeName ?? '').trim()
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'actionId')) {
    next.actionId = String(patch.actionId ?? '').trim()
  }
  return next
}
