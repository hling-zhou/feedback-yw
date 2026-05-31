export const TAGGING_IN_PROGRESS_TITLE = '打标进行中'

export const TAGGING_TASK_LEAVE_HINT = '可切换至其他页面，完成后将通知您'

/**
 * 导入流程中是否处于打标阶段（规则初标、增强打标或子步骤）
 * @param {string | undefined} progress
 */
export function isImportTaggingPhase(progress) {
  return /(?:规则初标|增强打标|打标)/.test(progress || '')
}

/**
 * @param {{ progress?: string; total?: number; dataMonth?: string; scopeLabel?: string; hint?: string }} opts
 */
export function formatTaggingProgressDescription({ progress, total, dataMonth, scopeLabel, hint }) {
  const parts = [progress || '正在处理…']
  if (scopeLabel) parts.push(scopeLabel)
  if (total) parts.push(`共 ${total} 条`)
  if (dataMonth) parts.push(`数据月份 ${dataMonth}`)
  parts.push(hint || TAGGING_TASK_LEAVE_HINT)
  return parts.join(' · ')
}

/**
 * @param {{ progress?: string; dataMonth?: string; hint?: string }} opts
 */
export function formatImportProgressDescription({ progress, dataMonth, hint }) {
  const parts = [progress || '正在处理…']
  if (dataMonth) parts.push(`数据月份 ${dataMonth}`)
  parts.push(hint || TAGGING_TASK_LEAVE_HINT)
  return parts.join(' · ')
}
