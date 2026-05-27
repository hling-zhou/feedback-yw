import { Alert } from 'antd'
import {
  formatImportProgressDescription,
  formatTaggingProgressDescription,
  isImportTaggingPhase,
  TAGGING_IN_PROGRESS_TITLE,
  TAGGING_TASK_LEAVE_HINT,
} from '../lib/taggingTaskUI.js'

/**
 * 批量重新打标 / 导入打标阶段的进行中提示
 * @param {{ progress?: string; total?: number; scopeLabel?: string; className?: string }} props
 */
export function TaggingProgressAlert({ progress, total, scopeLabel, className = 'page-section-sm' }) {
  return (
    <Alert
      className={className}
      type="info"
      showIcon
      title={TAGGING_IN_PROGRESS_TITLE}
      description={
        <span className="text-ink-600">
          {formatTaggingProgressDescription({
            progress,
            total,
            scopeLabel,
            hint: TAGGING_TASK_LEAVE_HINT,
          })}
        </span>
      }
    />
  )
}

/**
 * 数据导入全流程进度（打标阶段标题为「打标进行中」）
 * @param {{ progress?: string; dataMonth?: string; className?: string }} props
 */
export function ImportProgressAlert({ progress, dataMonth, className = 'page-section-sm' }) {
  const taggingPhase = isImportTaggingPhase(progress)
  return (
    <Alert
      className={className}
      type="info"
      showIcon
      title={taggingPhase ? TAGGING_IN_PROGRESS_TITLE : '数据导入进行中'}
      description={
        <span className="text-ink-600">
          {formatImportProgressDescription({
            progress,
            dataMonth,
            hint: TAGGING_TASK_LEAVE_HINT,
          })}
        </span>
      }
    />
  )
}
