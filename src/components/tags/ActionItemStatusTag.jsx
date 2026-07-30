import { ACTION_ITEM_STATUS_LABELS } from '../../domain/actionItem.js'
import { getActionItemStatusVisual } from '../../domain/actionItemStatusStyle.js'

/**
 * @param {{ status: import('../../domain/actionItem.js').ActionItemStatus | string; className?: string }}
 */
export default function ActionItemStatusTag({ status, className = '' }) {
  const visual = getActionItemStatusVisual(status)
  const label = ACTION_ITEM_STATUS_LABELS[/** @type {keyof typeof ACTION_ITEM_STATUS_LABELS} */ (status)] || status

  return (
    <span
      className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium leading-none ${visual.tagTextClass} ${className}`}
      style={{ backgroundColor: visual.chartColor }}
    >
      {label}
    </span>
  )
}
